// 生成 format 1 的插件市场索引，并用 DSH 官方校验器验证。
// 用法：
//   node build-index.mjs                          → npm 源，仓库地址取 package.json
//   node build-index.mjs <repoUrl>                → npm 源，指定仓库地址
//   node build-index.mjs <repoUrl> <commitSha>    → git 源，钉到某个 40 位 commit（不用发 npm）
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { homedir } from 'node:os'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const iconSvg = readFileSync(join(root, pkg.icon ?? 'icon.svg'))
const repoUrl =
  process.argv[2] ?? pkg.repository?.url?.replace(/^git\+/, '').replace(/\.git$/, '') ?? 'https://github.com/REPLACE-ME/dsh-plugin-ego'
const commitSha = process.argv[3]

if (commitSha && !/^[0-9a-f]{40}$/.test(commitSha)) {
  console.error(`commit 必须是 40 位小写 hex，收到：${commitSha}`)
  process.exit(1)
}

/** npm 源直接用版本号；git 源必须钉死 commit。 */
const source = commitSha ? { type: 'git', url: repoUrl, commit: commitSha } : { type: 'npm' }

/** 版本发布时间（Unix 秒）。CI 里建议改成 npm registry 返回的 time[version]，这里取当前时间。 */
const publishTimestamp = Math.floor(Date.now() / 1000)

const index = {
  format: 1,
  title: { en: 'Ego Browser Tools', zh: 'Ego 浏览器工具' },
  description: {
    en: 'Drive the ego lite browser from DSH: open pages with the user’s real logins, read them, act on them, and download files.',
    zh: '把 ego lite 浏览器接成 DSH 工具：用用户真实登录态打开、读取、操作页面并下载文件。',
  },
  metadata: {
    categories: {
      browser: { title: { en: 'Browser', zh: '浏览器' } },
    },
    labels: {},
    sortKeys: {},
  },
  plugins: [
    {
      name: pkg.name,
      title: { en: 'Ego Browser Tools', zh: 'Ego 浏览器工具' },
      description: {
        en: 'Open, read, act on and download from sites inside the ego lite browser — including sites that need login or trip bot checks. Requires ego lite to be installed first.',
        zh: '在 ego lite 里打开、读取、操作页面并下载文件，需要登录或有反爬的站点也能用。需先安装 ego lite 浏览器。',
      },
      icon: `data:image/svg+xml;base64,${iconSvg.toString('base64')}`,
      author: pkg.author ?? 'you',
      homepage: repoUrl,
      repository: { url: repoUrl },
      metadata: {
        category: 'browser',
        keywords: ['browser', 'automation', 'chromium', 'ego', 'crawler', 'download'],
        labels: [],
        sortKeys: {},
      },
      versions: [
        {
          version: pkg.version,
          publishTimestamp,
          source,
          engines: { dsh: pkg.engines?.dsh ?? '>=0.2.2-rc.1' },
        },
      ],
    },
  ],
}

writeFileSync(join(here, 'index.json'), `${JSON.stringify(index, null, 2)}\n`, 'utf8')

// 用本机 DSH profile 里自带的官方校验器验一遍，确保市场读得懂。
const validatorPath = join(
  homedir(),
  '.dsh/profiles/desktop/node_modules/@deepseek-ai/dsh-plugin-market-index/lib/index.js',
)
try {
  const { parseMarketIndex } = await import(pathToFileURL(validatorPath).href)
  const parsed = parseMarketIndex(index, 'https://example.com/index.json')
  const [plugin] = parsed.plugins
  console.log(`OK format=${parsed.format} plugins=${parsed.plugins.length}`)
  console.log(`  ${plugin.name} default=${plugin.versions[0].version} engines.dsh=${plugin.versions[0].engines.dsh}`)
  console.log(`  install spec = ${plugin.name}@${plugin.versions[0].version}`)
} catch (error) {
  if (error?.name === 'MarketIndexError') {
    console.error(`INVALID at ${error.path}: ${error.reason}`)
    process.exitCode = 1
  } else {
    console.warn(`校验器没跑起来（索引文件已生成，可手动校验）：${error.message}`)
  }
}
