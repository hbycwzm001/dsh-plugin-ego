# Ego 浏览器工具（dsh-plugin-ego）

把本机 **ego lite** 浏览器接成 DSH 的全局工具。它跑的是真正的 Chromium，带用户的登录态与代理设置，所以适合需要登录、有人机校验或反爬的站点——这些正是内置 HTTP 抓取做不到的。

## 工具

| 工具 | 作用 |
| --- | --- |
| `ego_open` | 打开网址，返回 `spaceId`、`page` 标签和页面快照 |
| `ego_read` | 读页面：`snapshot`（无障碍树）、`text`（正文）、`html`、或 `script`（页面内执行 JS 取值） |
| `ego_act` | 按顺序执行最多 20 步：`goto`/`click`/`fill`/`press`/`type`/`scroll`/`wait`/`waitFor`/`select`/`screenshot`/`eval` |
| `ego_fetch` | 用当前页面的 cookies 与代理发请求；给 `saveAs` 时直接落盘（下载视频、图片、PDF） |
| `ego_close` | 结束任务空间；`keep` 留页面给用户看 |

连续操作同一个页面时，把 `ego_open` / `ego_act` 返回的 `spaceId`（以及 `page`）传回来即可复用。

## 依赖

1. 安装 [ego lite](https://lite.ego.app/)（Chromium 版本，Agent 通过 `ego-browser` CLI 驱动它）。
2. **完整走完首次启动的引导（onboarding）**，否则每次调用都会返回「还没完成首次引导」的提示。
3. `ego-browser` 在 PATH 里，或者在配置里写死 `egoBin` 的绝对路径。

## 配置

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `egoBin` | `""` | `ego-browser.exe` 的绝对路径；留空则依次查 PATH、`~/.local/share/ego/active_version_dir/` |
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
