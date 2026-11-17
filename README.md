# Ego 浏览器工具（dsh-plugin-ego）

把本机 **ego lite** 浏览器接成 DSH 的全局工具。它跑的是真正的 Chromium，带用户的登录态与代理设置，所以适合需要登录、有人机校验或反爬的站点——这些正是内置 HTTP 抓取做不到的。

## 安装

在 DSH 里让 Agent 安装（底层是 `plugin_manager install_bundle`），`target` 三选一：

| target | 说明 |
| --- | --- |
| `git+https://github.com/hbycwzm001/dsh-plugin-ego.git#a2d74bc5bae775cff8deaf706b1a31fc580f4276` | 从 GitHub 装，不用 npm；本机需要能访问 github.com |
| `F:\path\to\dsh-plugin-ego` | 本地目录（开发时用，pnpm link，改代码重载即可） |
| `dsh-plugin-ego@0.1.0` | 发布到 npm 之后可用 |

**走插件市场**：在「插件 → 发现 → 添加索引源」里粘贴

```
https://hbycwzm001.github.io/dsh-plugin-ego/market/index.json
```

（GitHub Pages 托管，随 `git push` 自动更新，加一次就长期有效。）
备用镜像：`https://gcore.jsdelivr.net/gh/hbycwzm001/dsh-plugin-ego@main/market/index.json`
（jsDelivr 对 `@main` 有缓存，刚推完可能还是旧内容；`raw.githubusercontent.com` 在国内需代理。）
添加完搜 `dsh-plugin-ego` 就能一键装。

## 发布（维护者用）

```powershell
# 改完代码，一条命令发布：提交 → 推送 → 索引重钉 → 等 Pages 生效
.\release.ps1 -Message "feat: 支持 xx"

# 升版本号 + 打 GitHub Release
.\release.ps1 -Message "feat: v0.2" -Bump minor -Release
```

脚本会：提交工作区改动 → 推 `main` → 用新 commit 重建 `market/index.json` → 校验 → 再提交推送 → 轮询 Pages 直到线上索引的 sha 与本次 commit 一致，最后打印索引地址和安装 spec。

## 工具

| 工具 | 作用 |
| --- | --- |
| `ego_open` | 打开网址，返回 `spaceId`、`page` 标签和页面快照 |
| `ego_read` | 读页面：`snapshot`（无障碍树）、`text`（正文）、`html`、或 `script`（页面内执行 JS 取值） |
| `ego_act` | 按顺序执行最多 20 步：`goto`/`click`/`fill`/`press`/`type`/`scroll`/`wait`/`waitFor`/`select`/`screenshot`/`eval` |
| `ego_fetch` | 用当前页面的 cookies 与代理发请求；给 `saveAs` 时直接落盘（下载视频、图片、PDF） |
| `ego_install` | 按系统/架构下载并静默安装 ego lite（已装好则直接返回路径） |
| `ego_close` | 结束任务空间；`keep` 留页面给用户看 |

连续操作同一个页面时，把 `ego_open` / `ego_act` 返回的 `spaceId`（以及 `page`）传回来即可复用。

## 依赖（会自动装）

ego lite 是唯一的外部依赖，插件会**自己搞定**：缺浏览器时按 `process.platform` + `process.arch` 选官方安装包（Windows 19MB / macOS 150MB），下载并静默安装，装完自动定位可执行文件。

- 默认 `autoInstall: true`：第一次调用工具发现没装，就会自动装好再继续，不用人管；
- 也可以显式让 Agent 调 `ego_install`（或 `ego_install {reinstall:true}` 覆盖重装）；
- Linux 官方没有包，会直接说明并给出手动地址。

**只剩一步需要用户本人**：装好后打开 ego lite，**走完首次引导（onboarding）**；想让它直接带登录态，引导里可以选从 Chrome 导入数据。引导没走完时，任何调用都会返回中文提示而不是一堆报错。

## 配置

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `egoBin` | `""` | `ego-browser` 的绝对路径；留空则依次查 PATH、`~/.local/share/ego/active_version_dir/`、各平台安装目录 |
| `autoInstall` | `true` | 缺浏览器时自动下载安装（关掉就只提示、不下载） |
| `downloadProxy` | `""` | 下载安装包时用的代理，例如 `http://127.0.0.1:10809`（`cdn.ego.app` 直连不通时用） |
| `timeoutMs` | `120000` | 单次调用（含页面加载）的上限 |
| `maxChars` | `40000` | 快照/正文/HTML 返回给模型时的截断长度 |
| `spaceName` | `DSH 网页操作` | 新建任务空间时用的名字 |

## 实现要点

- 每次调用写一个临时 `.mjs`（`os.tmpdir()/dsh-ego-*`），用 `ego-browser nodejs -e "await import('file:///…')"` 执行，脚本把结果以 `##EGO-RESULT##` 前缀打印成 JSON 回传。
- 传入 `spaceId` 时，按空间归属决定 `taskSpace` / `claimTaskSpace` / `takeOverTaskSpace`，和 ego 官方推荐的续接方式一致。
- 点击命中弹窗时会把后续步骤切到新标签页。
- 超时会终止子进程；onboarding 未完成的报错会被翻译成中文提示。

## 海外站点与代理

ego lite 走系统代理设置。本机当前 **系统代理是关闭的**（`ProxyEnable=0`，虽然 `ProxyServer` 已填 `127.0.0.1:10809`），所以 YouTube / TikTok 这类站点在 ego 里会 `ERR_CONNECTION_TIMED_OUT`。

两种修法（任选其一）：

1. 打开 Clash/xray 的「系统代理」开关，ego lite 立即生效；
2. 关掉 ego lite 后，用代理参数重启它：
   `& "C:\Program Files\Citro Labs\ego lite\Application\ego.exe" --proxy-server="http://127.0.0.1:10809"`

## 已知限制

- 需要 ego lite 的图形界面在跑；纯无头环境不适用。
- `page.evaluate()` 没有超时参数，长任务要拆成多次调用。
- 下载走 `page.fetch()`，受浏览器同源与 CORS 约束；跨域资源用 `ego_act` 里的导航 + `ego_fetch` 在同一站点内取值更稳。
