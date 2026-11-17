<#
  发布 dsh-plugin-ego：提交 → 推送 → 把市场索引重新钉到新 commit → 等 GitHub Pages 生效。

  用法：
    .\release.ps1 -Message "feat: 新增 xx"
    .\release.ps1 -Message "fix: 修 xx" -Bump patch
    .\release.ps1 -Message "feat: v2" -Bump minor -Release

  参数：
    -Message  必填，提交说明
    -Bump     none|patch|minor|major，改 package.json 的 version（默认 none）
    -Release  发版时顺带创建 GitHub Release 并上传 zip
    -SkipWait 不等待 Pages 生效（只推送就跑）
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Message,
  [ValidateSet('none', 'patch', 'minor', 'major')][string]$Bump = 'none',
  [switch]$Release,
  [switch]$SkipWait
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

function Info($text) { Write-Host "==> $text" -ForegroundColor Cyan }
function Warn($text) { Write-Host "!!  $text" -ForegroundColor Yellow }
function Fail($text) { Write-Host "xx  $text" -ForegroundColor Red; exit 1 }

function Find-Node {
  $candidates = @(
    (Join-Path $env:USERPROFILE '.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe')
  )
  foreach ($candidate in $candidates) { if (Test-Path $candidate) { return $candidate } }
  $onPath = Get-Command node -ErrorAction SilentlyContinue
  if ($onPath) { return $onPath.Source }
  Fail '找不到 node.exe'
}

function Write-Utf8NoBom($path, $text) {
  [System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))
}

$node = Find-Node
$pkgPath = Join-Path $root 'package.json'
$pkg = Get-Content $pkgPath -Raw -Encoding UTF8 | ConvertFrom-Json

# 仓库地址与 Pages 地址从 git remote 推出来，换仓库不用改脚本。
$remote = (git remote get-url origin 2>$null)
if (-not $remote) { Fail 'origin 没设置，先 git remote add origin <url>' }
$m = [regex]::Match($remote, 'github\.com[:/](?<owner>[^/]+)/(?<repo>[^/.]+)')
if (-not $m.Success) { Fail "解析不了 origin：$remote" }
$owner = $m.Groups['owner'].Value
$repoName = $m.Groups['repo'].Value
$repoUrl = "https://github.com/$owner/$repoName"
$indexUrl = "https://$($owner.ToLower()).github.io/$repoName/market/index.json"

$branch = (git rev-parse --abbrev-ref HEAD).Trim()
if ($branch -ne 'main') { Warn "当前分支是 $branch，不是 main" }

# 1. 改版本号
if ($Bump -ne 'none') {
  $parts = $pkg.version.Split('.')
  $major = [int]$parts[0]; $minor = [int]$parts[1]; $patch = [int]$parts[2]
  switch ($Bump) {
    'major' { $major++; $minor = 0; $patch = 0 }
    'minor' { $minor++; $patch = 0 }
    'patch' { $patch++ }
  }
  $newVersion = "$major.$minor.$patch"
  $pkg.version = $newVersion
  Write-Utf8NoBom $pkgPath (($pkg | ConvertTo-Json -Depth 20) + "`n")
  Info "版本号 $($parts -join '.') -> $newVersion"
}

# 2. 提交并推送
git add -A | Out-Null
$staged = git diff --cached --name-only
if (-not $staged) {
  Info '工作区没有改动，跳过提交'
} else {
  Info ("提交 " + ($staged -join ', '))
  git commit -m $Message | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail 'git commit 失败' }
}

$sha = (git rev-parse HEAD).Trim()
Info "推送 $branch ($($sha.Substring(0,7)))"
git push origin $branch | Out-Null
if ($LASTEXITCODE -ne 0) { Fail 'git push 失败' }

# 3. 把索引钉到这次发布的 commit
Info '重建市场索引'
Push-Location (Join-Path $root 'market')
& $node build-index.mjs $repoUrl $sha
$buildExit = $LASTEXITCODE
Pop-Location
if ($buildExit -ne 0) { Fail '索引校验失败，已停在本地，检查 market/index.json' }

git add -A | Out-Null
if (git diff --cached --name-only) {
  git commit -m "chore(market): 索引钉到 $($sha.Substring(0,7))" | Out-Null
  git push origin $branch | Out-Null
  Info '索引已更新并推送'
} else {
  Info '索引没变化'
}

# 4. 等 Pages 生效（用 node 探测：PS 5.1 的 Invoke-RestMethod 对 github.io 会卡在超时）
if (-not $SkipWait) {
  Info "等待 GitHub Pages 生效：$indexUrl"
  $probe = Join-Path $env:TEMP "dsh-pages-probe-$PID.mjs"
  @'
const [url, want] = process.argv.slice(2)
const full = `${url}?t=${Date.now()}`
try {
  const r = await fetch(full, { signal: AbortSignal.timeout(15000) })
  if (!r.ok) { console.log(`HTTP ${r.status}`); process.exit(1) }
  const j = await r.json()
  const sha = j?.plugins?.[0]?.versions?.[0]?.source?.commit ?? ''
  console.log(sha)
  process.exit(sha === want ? 0 : 2)
} catch (e) {
  console.log(e.cause?.code || e.name)
  process.exit(1)
}
'@ | Write-Utf8NoBom $probe $_
  $ok = $false
  for ($i = 1; $i -le 30; $i++) {
    Start-Sleep -Seconds 8
    $live = & $node $probe $indexUrl $sha 2>&1
    if ($LASTEXITCODE -eq 0) { $ok = $true; Info "已生效（第 $i 次探测，约 $($i * 8) 秒）"; break }
    Write-Host "    第 $i 次：$live"
  }
  Remove-Item $probe -Force -ErrorAction SilentlyContinue
  if (-not $ok) { Warn "等了约 4 分钟还没刷新，稍后再访问：$indexUrl" }
}

# 5. 可选：发 GitHub Release
if ($Release) {
  $tag = "v$($pkg.version)"
  $zip = Join-Path $root "dist\dsh-plugin-ego-$($pkg.version).zip"
  New-Item -ItemType Directory -Path (Split-Path -Parent $zip) -Force | Out-Null
  if (Test-Path $zip) { Remove-Item $zip -Force }
  $items = @('index.js', 'cordis.patch.yml', 'package.json', 'icon.svg', 'README.md', 'PUBLISH.md', 'LICENSE', 'locale', 'market') |
    ForEach-Object { Join-Path $root $_ } | Where-Object { Test-Path $_ }
  Compress-Archive -Path $items -DestinationPath $zip -Force
  Info "创建 Release $tag"
  gh release create $tag $zip --title $tag --notes "安装：git+$repoUrl.git#$sha" | Out-Null
  if ($LASTEXITCODE -ne 0) { Warn "Release 创建失败（tag $tag 可能已存在）" }
}

Info '完成'
Write-Host "  最新 commit : $($sha.Substring(0,7))"
Write-Host "  索引地址    : $indexUrl"
Write-Host "  安装 spec   : git+$repoUrl.git#$sha"
