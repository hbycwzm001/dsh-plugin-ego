# 让别人用上这个插件

包本体：`index.js`、`cordis.patch.yml`、`package.json`、`icon.svg`、`README.md`、`locale/{zh,en}.json`，约 26KB。

**当前状态（已发布）**

| 项 | 值 |
| --- | --- |
| 仓库 | <https://github.com/hbycwzm001/dsh-plugin-ego>（public） |
| 索引 | <https://gcore.jsdelivr.net/gh/hbycwzm001/dsh-plugin-ego@main/market/index.json> |
| 备用索引 | <https://fastly.jsdelivr.net/gh/hbycwzm001/dsh-plugin-ego@main/market/index.json>（raw.githubusercontent 国内需代理） |
| 源类型 | `git`，钉在 `a2d74bc5bae775cff8deaf706b1a31fc580f4276`（= v0.1.0 代码） |
| 安装 spec | `git+https://github.com/hbycwzm001/dsh-plugin-ego.git#a2d74bc5bae775cff8deaf706b1a31fc580f4276` |

已实测：`pnpm add <上面的 spec>` 成功（6.4s，`+ dsh-plugin-ego 0.1.0`）；两个 jsDelivr 镜像在**不开代理**时也能直连拿到索引（200 / format=1）。

剩下只有一步，**必须你在界面里做**：插件 → 发现 → 添加索引源 → 粘贴上面的索引 URL。

---

三条路，从轻到重。

---

## 路线 1：发压缩包（同事/朋友，5 分钟）

```powershell
Compress-Archive -Path "F:\yuyinzhuanhuan\dsh-plugin-ego\*" -DestinationPath "dsh-plugin-ego-0.1.0.zip"
```

对方解压到任意目录，在 DSH 里说「安装插件，目录 D:\tools\dsh-plugin-ego」（底层是
`plugin_manager install_bundle`，`target` 填那个**绝对路径**）。装完立刻可用，不用重启。

> 目录安装是 pnpm link（junction），对方以后改源码只需重载插件，不用重装。

---

## 路线 2：发 npm（对外通用）

```powershell
cd F:\yuyinzhuanhuan\dsh-plugin-ego
# 1. 删掉 "private": true；name 换成没人占的名字（如 @你的域/dsh-plugin-ego）；升 version
npm login
npm publish --access public
```

别人：`install_bundle`，`target = "dsh-plugin-ego@0.1.0"`。

`peerDependencies` 全是 optional，对方不会因为装这个被拖一堆依赖；`engines.dsh` 会拦住版本不符的 DSH。

---

## 路线 3：上 DSH 插件市场（能被搜到、一键装）

市场只认一件事：一个 **format 1** 的 `index.json`，放在一个 **http(s) 地址**上。市场插件自己不含"提交入口"，也不含官方索引——所以"上市场"= 自己发一份索引 + 把 URL 加进「发现」。

### 3.1 format 1 的骨架

```json
{
  "format": 1,
  "title": { "en": "Ego Browser Tools", "zh": "Ego 浏览器工具" },
  "description": { "en": "...", "zh": "..." },
  "metadata": {
    "categories": { "browser": { "title": { "en": "Browser", "zh": "浏览器" } } },
    "labels": {},
    "sortKeys": {}
  },
  "plugins": [
    {
      "name": "dsh-plugin-ego",
      "title": { "en": "Ego Browser Tools", "zh": "Ego 浏览器工具" },
      "description": { "en": "...", "zh": "..." },
      "icon": "data:image/svg+xml;base64,...",
      "author": "you",
      "homepage": "https://github.com/you/dsh-plugin-ego",
      "repository": { "url": "https://github.com/you/dsh-plugin-ego" },
      "metadata": { "category": "browser", "keywords": ["browser", "automation"], "labels": [], "sortKeys": {} },
      "versions": [
        {
          "version": "0.1.0",
          "publishTimestamp": 1763400000,
          "source": { "type": "npm" },
          "engines": { "dsh": ">=0.2.2-rc.1" }
        }
      ]
    }
  ]
}
```

规则（来自 `@deepseek-ai/dsh-plugin-market-index` 的校验器）：

| 字段 | 约束 |
| --- | --- |
| `format` | 必须是数字 `1` |
| `title` / `description` | `string` 或 `{ "en": "...", "zh": "..." }`，**`en` 必填** |
| `icon` | base64 `data:` URL（解码后 ≤32KiB）或绝对 URL；相对路径会按索引 URL 解析 |
| `versions` | 非空，按 SemVer 降序；`version` 精确、`publishTimestamp` 是 Unix 秒 |
| `source` | `{"type":"npm","registry"?:url}` 或 `{"type":"git","url",commit,path"?}`；git 的 `commit` 必须是**40 位小写 hex** |
| `engines.dsh` | SemVer range，缺省表示任意 DSH 版本 |
| `metadata.category/labels` | 用到的 id 必须在上面的 `metadata.categories/labels` 里声明 |
| 未知字段 | 被丢弃（不报错），但已知字段会严格校验 |

### 3.2 生成 + 校验（本机已跑通）

`market/build-index.mjs` 会读 `package.json` 和 `icon.svg` 生成 `index.json`，然后调用本机 DSH 自带的官方校验器验一遍：

```powershell
$node = "C:\Users\禹涵宝贝\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
cd F:\yuyinzhuanhuan\dsh-plugin-ego\market
& $node build-index.mjs "https://github.com/you/dsh-plugin-ego"
# 输出：OK format=1 plugins=1 / install spec = dsh-plugin-ego@0.1.0
```

校验器路径：`~/.dsh/profiles/desktop/node_modules/@deepseek-ai/dsh-plugin-market-index/lib/index.js`。
它报错会给出 `path`（出问题的字段路径）和 `reason`。

### 3.3 把 index.json 放到公网 https 上

任选：

- **GitHub Pages / Raw**：`https://raw.githubusercontent.com/you/dsh-plugin-ego/main/market/index.json`
  （raw 是 `text/plain`，市场按 JSON 解析，无所谓 Content-Type）
- **jsDelivr**：把索引也发成 npm 包，`https://cdn.jsdelivr.net/npm/<pkg>/index.json`
  （社区那个 `dsh-plugin-catalog` 就是这么干的）
- 自己的 CDN / 对象存储，公开可读即可

本地自测：`python -m http.server 8080`，索引源填 `http://127.0.0.1:8080/index.json`
（校验器的 URL 规则是 `^https?://`，http 也认）。

### 3.4 加进「发现」——这步只有你能做

市场插件的工具说明写得很明确：**"Only the user can add or remove index sources."**
所以最后一步必须你在界面里点：**插件 → 发现 → 添加索引源 → 粘贴你的 index.json URL**。

加完会在设置里写进 `indexes: string[]`（`~/.dsh/profiles/desktop` 对应 entry 的配置），
之后「发现」页就能搜到 `dsh-plugin-ego`，点安装走的正是
`plugin_manager install_bundle`，`target` 由 `marketInstallTarget(name, version)` 算出来：

- npm 源 → `dsh-plugin-ego@0.1.0`
- git 源 → `git+https://github.com/you/dsh-plugin-ego.git#<40位commit>`

### 3.5 免 npm 的替代路线：git 源

不想发 npm 也能上市场，只要有个公开 GitHub 仓库：

```json
"source": { "type": "git", "url": "https://github.com/you/dsh-plugin-ego", "commit": "<40位小写sha>", "path": "" }
```

代价：对方机器上要有 `git`，且 `commit` 钉死后每次发版都要更新索引。所以对外推荐 npm，内部小范围用 git 更省事。

### 3.6 或者直接进社区索引

`dsh-plugin-catalog`（Awesome DSH Plugin，约 5600 条）是公共索引，发 npm 后给那个仓库提 PR 把你的条目加进去，别人用他们那个 URL 就能搜到你。

---

## 对方必须满足的前置条件

| 依赖 | 说明 |
| --- | --- |
| ego lite | <https://lite.ego.app/>，装完**走完 onboarding** |
| `ego-browser` | onboarding 后会写进用户 PATH；没写就靠插件的 `egoBin` 配置指绝对路径 |
| DSH | `>=0.2.2-rc.1`（`package.json` 的 `engines.dsh` 已声明） |
| 代理 | 访问 YouTube/TikTok 需要系统代理或 `--proxy-server`，否则正常超时 |

## 分发时要提醒对方的两件事

1. **登录态在对方自己机器上**——插件只是驱动本地浏览器，不会、也不能把登录态传出去；
2. **操作在对方浏览器里真实发生**：插件用独立 task space，结束时 `finish()` 回收；要留页面给用户看才 `keep`。
