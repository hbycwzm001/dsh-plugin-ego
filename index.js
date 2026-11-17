import { spawn } from 'node:child_process'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, delimiter } from 'node:path'
import { randomBytes } from 'node:crypto'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'

const MARK = '##EGO-RESULT##'
const MAX_ACTIONS = 20

export const inject = ['tools']

export const Config = z.object({
  egoBin: z.string().default(''),
  timeoutMs: z.number().default(120000),
  maxChars: z.number().default(40000),
  spaceName: z.string().default('DSH 网页操作'),
})

/** Locate the ego-browser executable: configured path, then PATH, then the known install location. */
function resolveBin(config) {
  if (config.egoBin) return config.egoBin
  const names = ['ego-browser.exe', 'ego-browser.cmd', 'ego-browser']
  for (const dir of String(process.env.PATH ?? process.env.Path ?? '').split(delimiter)) {
    if (!dir) continue
    for (const name of names) {
      const candidate = join(dir, name)
      if (existsSync(candidate)) return candidate
    }
  }
  const home = process.env.USERPROFILE ?? process.env.HOME ?? ''
  const known = join(home, '.local', 'share', 'ego', 'active_version_dir', 'ego-browser.exe')
  return existsSync(known) ? known : null
}

/** What to tell the user when the browser itself is missing — this is the plugin's only hard dependency. */
const MISSING_EGO_HELP = [
  '这台机器上还没装 ego lite，所以这个插件暂时没法用。请照下面三步做：',
  '1. 打开 https://lite.ego.app/ 下载并安装 ego lite（Windows 直连下载：https://cdn.ego.app/setup/windows/x64/egoliteSetup.exe）',
  '2. 启动 ego lite，**把首次引导（onboarding）走完**；想让它直接有登录态，可以在引导里选择从 Chrome 导入数据',
  '3. 回到这里重新调用即可（ego-browser 会随引导写进 PATH，通常不用重启 DSH）',
  '',
  '如果已经装好但仍报这个错：把 ego-browser.exe 的绝对路径填进插件配置的 egoBin，或确认它在 PATH 里。',
].join('\n')

/** Run one browser script through `ego-browser nodejs` and return the value it reports. */
async function runEgo(code, config, options = {}) {
  const bin = resolveBin(config)
  if (!bin) throw new Error(MISSING_EGO_HELP)
  const dir = join(tmpdir(), `dsh-ego-${randomBytes(5).toString('hex')}`)
  await mkdir(dir, { recursive: true })
  const file = join(dir, 'task.mjs')
  const prelude = `const CFG = ${JSON.stringify({
    ...options.vars,
    marker: MARK,
    spaceName: config.spaceName,
    maxChars: config.maxChars,
  })};\n`
  await writeFile(file, prelude + code, 'utf8')
  const specifier = `file:///${file.replace(/\\/g, '/')}`
  const timeout = options.timeoutMs ?? config.timeoutMs

  try {
    const { stdout, stderr, code: exitCode } = await new Promise((resolve, reject) => {
      const child = spawn(bin, ['nodejs', '-e', `await import('${specifier}')`], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let out = ''
      let err = ''
      const timer = setTimeout(() => {
        try { child.kill() } catch {}
        reject(new Error(`ego-browser did not finish within ${timeout}ms`))
      }, timeout)
      child.stdout.on('data', (chunk) => { out += String(chunk) })
      child.stderr.on('data', (chunk) => { err += String(chunk) })
      child.on('error', (error) => {
        clearTimeout(timer)
        if (error && error.code === 'ENOENT') reject(new Error(MISSING_EGO_HELP))
        else reject(error)
      })
      child.on('close', (exit) => { clearTimeout(timer); resolve({ stdout: out, stderr: err, code: exit }) })
    })

    const streams = [stdout, stderr]
    let line = null
    for (const stream of streams) {
      for (const candidate of String(stream).split(/\r?\n/)) {
        if (candidate.includes(MARK)) line = candidate
      }
    }
    if (!line) {
      const message = (stderr || stdout).trim().slice(-1200)
      if (/onboarding/i.test(message)) {
        throw new Error(`ego lite 还没完成首次引导：请在弹出的 ego lite 引导窗口里走完流程后重试。原始输出：${message}`)
      }
      throw new Error(`ego-browser 没有返回结果（exit ${exitCode}）：${message || '无输出'}`)
    }
    const value = JSON.parse(line.slice(line.indexOf(MARK) + MARK.length))
    if (value && value.error) throw new Error(value.error)
    return value
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/** Shared script prelude: attach to an existing space or open a new one, then pick the page. */
const PRELUDE = String.raw`
const spaces = await listTaskSpaces();
const wantId = CFG.spaceId === undefined || CFG.spaceId === null ? null : Number(CFG.spaceId);
let task = null;
if (wantId !== null) {
  const entry = spaces.find((s) => s.id === wantId);
  if (entry) {
    task = entry.ownership === 'user'
      ? await claimTaskSpace(wantId)
      : entry.ownership === 'agentDelegatedToUser'
        ? await takeOverTaskSpace(wantId)
        : await taskSpace(wantId);
  }
}
if (!task) task = await taskSpace(CFG.spaceName);
const pages = await task.pages();
let page = (CFG.page ? pages.find((p) => p.label === CFG.page) : null) ?? pages[0] ?? null;
if (!page) {
  const tabs = await task.tabs();
  if (tabs.length > 0) page = await task.adopt(tabs[0].page);
}
if (!page) page = await task.newPage();
const clip = (text) => {
  const value = String(text ?? '');
  return value.length > CFG.maxChars
    ? value.slice(0, CFG.maxChars) + '\n…[truncated ' + (value.length - CFG.maxChars) + ' chars]'
    : value;
};
const emit = (value) => console.log(CFG.marker + JSON.stringify(value));
const describe = async () => ({
  spaceId: task.spaceId,
  page: page.label,
  url: await page.url().catch(() => ''),
  title: await page.title().catch(() => ''),
});
`

const TOOL_NOTE = '使用本机 ego lite 浏览器（Chromium，带用户真实登录态），适合需要登录、有反爬或人机校验的站点。'

export function apply(ctx, config) {
  ctx.tools.register(defineTool({
    name: 'ego_open',
    description: `${TOOL_NOTE}\n打开一个网址并返回页面快照。首次调用会创建任务空间；之后把返回的 spaceId 传回来就能继续操作同一个页面。`,
    parameters: {
      url: { type: 'string', required: true, description: '要打开的网址，例如 https://www.youtube.com/watch?v=xxx' },
      spaceId: { type: 'integer', description: '复用已有的任务空间 id（上一次调用返回的 spaceId）。' },
      page: { type: 'string', description: '复用已有的页面标签，例如 p1。' },
      timeoutMs: { type: 'integer', description: '等待页面加载的上限，默认沿用插件配置。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          spaceId: { type: 'integer', required: true, description: '任务空间 id，后续调用需要它。' },
          page: { type: 'string', required: true, description: '页面标签。' },
          url: { type: 'string' },
          title: { type: 'string' },
          snapshot: { type: 'string', description: '页面无障碍快照，过长会截断。' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `[space ${value.spaceId} · ${value.page}] ${value.title || value.url}\n${String(value.snapshot ?? '').slice(0, 4000)}` }],
    },
    presentCall: (args) => ({ card: 'generic', title: `ego · ${args.url}`, kind: 'other', rawInput: { url: args.url } }),
    presentResult: (_args, result) => ({ card: 'generic', title: result.isError ? 'ego open failed' : 'ego open', content: result.content }),
    async execute(args) {
      const code = PRELUDE + String.raw`
await page.goto(CFG.url, { timeout: CFG.navTimeout || 60000 });
const state = await describe();
emit({ ...state, snapshot: clip(await page.snapshot()) });
`
      return runEgo(code, config, {
        timeoutMs: args.timeoutMs,
        vars: { url: args.url, spaceId: args.spaceId, page: args.page, navTimeout: args.timeoutMs },
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'ego_read',
    description: `${TOOL_NOTE}\n读取当前页面的内容：快照（默认）、正文纯文本、HTML，或在页面里执行一段 JavaScript 取值。`,
    parameters: {
      spaceId: { type: 'integer', description: '任务空间 id。' },
      page: { type: 'string', description: '页面标签。' },
      mode: {
        type: 'string',
        enum: ['snapshot', 'text', 'html', 'script'],
        default: 'snapshot',
        description: 'snapshot=无障碍快照；text=可见正文；html=当前 DOM；script=执行 script 参数并返回其结果。',
      },
      script: { type: 'string', description: 'mode=script 时在页面上下文执行的表达式或函数体，需返回可序列化值。' },
      fullPage: { type: 'boolean', description: 'snapshot 模式是否包含整个文档而不只是视口，默认 false。' },
      maxChars: { type: 'integer', description: '返回内容上限，默认沿用插件配置。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          spaceId: { type: 'integer', required: true },
          page: { type: 'string', required: true },
          url: { type: 'string' },
          title: { type: 'string' },
          content: { type: 'string', required: true, description: '读取到的内容，超过上限会截断。' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.content }],
    },
    presentCall: (args) => ({ card: 'generic', title: `ego read · ${args.mode ?? 'snapshot'}`, kind: 'other', rawInput: { mode: args.mode ?? 'snapshot' } }),
    presentResult: (_args, result) => ({ card: 'generic', title: result.isError ? 'ego read failed' : 'ego read', content: result.content }),
    async execute(args) {
      const mode = args.mode ?? 'snapshot'
      const body = mode === 'script'
        ? `const value = await page.evaluate(CFG.script);\nout.content = typeof value === 'string' ? clip(value) : clip(JSON.stringify(value, null, 1));`
        : mode === 'text'
          ? `out.content = clip(await page.evaluate(() => document.body ? document.body.innerText : ''));`
          : mode === 'html'
            ? `out.content = clip(await page.evaluate(() => document.documentElement ? document.documentElement.outerHTML : ''));`
            : `out.content = clip(await page.snapshot(CFG.fullPage ? { scope: 'full_page' } : undefined));`
      const code = PRELUDE + String.raw`
const out = await describe();
${body}
emit(out);
`
      return runEgo(code, config, { vars: { ...args } })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'ego_act',
    description: `${TOOL_NOTE}\n在当前页面上执行一串操作（点击、填写、按键、滚动、跳转、截图），返回每一步的结果和操作后的页面快照。`,
    parameters: {
      spaceId: { type: 'integer', description: '任务空间 id。' },
      page: { type: 'string', description: '页面标签。' },
      actions: {
        type: 'array',
        required: true,
        description: `按顺序执行的操作，最多 ${MAX_ACTIONS} 个。每项含 type 与相应字段。`,
        items: {
          type: 'object',
          additionalProperties: true,
          properties: {
            type: {
              type: 'string',
              enum: ['goto', 'click', 'fill', 'press', 'type', 'scroll', 'wait', 'waitFor', 'select', 'screenshot', 'eval'],
              required: true,
              description: '操作类型。',
            },
            selector: { type: 'string', description: 'click/fill/press/waitFor/select 的目标：快照引用 @12、text=…、loc=css:… 或 CSS 选择器。' },
            value: { type: 'string', description: 'fill/type/select/eval 的值，或 goto 的网址。' },
            key: { type: 'string', description: 'press 的按键名，例如 Enter、ControlOrMeta+A。' },
            ms: { type: 'integer', description: 'wait 的毫秒数。' },
            dy: { type: 'integer', description: 'scroll 的垂直像素，正数向下。' },
            path: { type: 'string', description: 'screenshot 的绝对保存路径。' },
            label: { type: 'string', description: '3-6 个词的动作说明，显示在光标旁。' },
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          spaceId: { type: 'integer', required: true },
          page: { type: 'string', required: true },
          url: { type: 'string' },
          title: { type: 'string' },
          steps: { type: 'array', description: '每一步的结果描述。' },
          snapshot: { type: 'string', description: '全部操作后的页面快照。' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `${(value.steps ?? []).join('\n')}\n\n${String(value.snapshot ?? '').slice(0, 3000)}` }],
    },
    presentCall: (args) => ({ card: 'generic', title: `ego act · ${(args.actions ?? []).length} 步`, kind: 'other', rawInput: { actions: args.actions } }),
    presentResult: (_args, result) => ({ card: 'generic', title: result.isError ? 'ego act failed' : 'ego act', content: result.content }),
    async execute(args) {
      const actions = (args.actions ?? []).slice(0, MAX_ACTIONS)
      const code = PRELUDE + String.raw`
const steps = [];
for (const action of CFG.actions) {
  try {
    switch (action.type) {
      case 'goto':
        await page.goto(action.value, { timeout: action.ms || 60000 });
        steps.push('goto ' + action.value);
        break;
      case 'click': {
        const receipt = await page.click(action.selector, action.label ? { label: action.label } : undefined);
        steps.push('click ' + action.selector);
        const popup = receipt && receipt.popups && receipt.popups[0];
        if (popup) {
          const next = task.page(popup.label);
          if (next) {
            page = next;
            steps.push('popup -> ' + popup.label);
            if (page.waitForLoadState) {
              await page.waitForLoadState('domcontentloaded').catch(() => {});
            }
          }
        } else if (receipt && receipt.dialog) {
          steps.push('dialog ' + (receipt.dialog.type || '') + ' left open');
        }
        break;
      }
      case 'fill':
        await page.fill(action.selector, action.value ?? '');
        steps.push('fill ' + action.selector);
        break;
      case 'press':
        await page.press(action.selector || undefined, action.key || 'Enter');
        steps.push('press ' + (action.key || 'Enter'));
        break;
      case 'type':
        await page.keyboard.type(action.value ?? '');
        steps.push('type ' + (action.value ?? '').length + ' chars');
        break;
      case 'scroll':
        await page.mouse.wheel(0, action.dy ?? 600, action.label ? { label: action.label } : undefined);
        steps.push('scroll ' + (action.dy ?? 600));
        break;
      case 'wait':
        await page.waitForTimeout(action.ms ?? 1000);
        steps.push('wait ' + (action.ms ?? 1000) + 'ms');
        break;
      case 'waitFor':
        await page.waitForSelector(action.selector, { state: 'visible', timeout: action.ms || 30000 });
        steps.push('waitFor ' + action.selector);
        break;
      case 'select':
        await page.selectOption(action.selector, { label: action.value });
        steps.push('select ' + action.value);
        break;
      case 'screenshot': {
        const saved = await page.screenshot(action.path ? { path: action.path } : {});
        steps.push('screenshot ' + saved);
        break;
      }
      case 'eval': {
        const value = await page.evaluate(action.value);
        steps.push('eval -> ' + clip(typeof value === 'string' ? value : JSON.stringify(value)));
        break;
      }
      default:
        steps.push('skip unknown type ' + action.type);
    }
  } catch (error) {
    steps.push(action.type + ' FAILED: ' + (error && error.message ? error.message : String(error)));
    break;
  }
}
const out = await describe();
out.steps = steps;
out.snapshot = clip(await page.snapshot());
emit(out);
`
      return runEgo(code, config, { vars: { ...args, actions } })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'ego_fetch',
    description: `${TOOL_NOTE}\n在页面上下文里发起 HTTP 请求（带该页面的 cookies 与代理设置），可把响应直接保存到本地文件——下载视频、图片、PDF 时用它。`,
    parameters: {
      url: { type: 'string', required: true, description: '要请求的地址；可以是页面内的相对路径。' },
      spaceId: { type: 'integer', description: '任务空间 id，用它来决定使用哪个页面的登录态。' },
      page: { type: 'string', description: '页面标签。' },
      saveAs: { type: 'string', description: '绝对保存路径，如 F:/dir/file.mp4。给出时以二进制保存响应体。' },
      method: { type: 'string', description: 'HTTP 方法，默认 GET。' },
      headers: { type: 'object', additionalProperties: true, description: '额外的请求头。' },
      body: { type: 'string', description: '请求体（字符串）。' },
      asText: { type: 'boolean', description: '为 true 时把响应体作为文本返回（截断到上限）。' },
      timeoutMs: { type: 'integer', description: '请求超时毫秒数。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          ok: { type: 'boolean', required: true },
          status: { type: 'integer' },
          url: { type: 'string' },
          bytes: { type: 'integer' },
          path: { type: 'string', description: 'saveAs 时实际写出的文件路径。' },
          text: { type: 'string', description: 'asText 时的响应正文（可能截断）。' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `${value.status} ${value.ok ? 'OK' : 'FAIL'} · ${value.bytes ?? 0} bytes${value.path ? ' → ' + value.path : ''}${value.text ? '\n' + String(value.text).slice(0, 2000) : ''}` }],
    },
    presentCall: (args) => ({ card: 'generic', title: `ego fetch · ${args.saveAs ? 'download' : 'request'}`, kind: 'other', rawInput: { url: args.url } }),
    presentResult: (_args, result) => ({ card: 'generic', title: result.isError ? 'ego fetch failed' : 'ego fetch', content: result.content }),
    async execute(args) {
      const code = PRELUDE + String.raw`
const options = {};
if (CFG.method) options.method = CFG.method;
if (CFG.headers) options.headers = CFG.headers;
if (CFG.body !== undefined) options.body = CFG.body;
if (CFG.saveAs) options.saveAs = CFG.saveAs;
if (CFG.timeoutMs) options.timeout = CFG.timeoutMs;
const response = await page.fetch(CFG.url, options);
const out = { ok: response.ok, status: response.status, url: response.url };
if (CFG.saveAs) {
  out.path = CFG.saveAs;
  try {
    const stat = await (await import('node:fs/promises')).stat(CFG.saveAs);
    out.bytes = stat.size;
  } catch {}
} else if (CFG.asText) {
  out.text = clip(response.body);
  out.bytes = String(response.body ?? '').length;
} else {
  out.bytes = String(response.body ?? '').length;
  out.text = clip(String(response.body ?? '').slice(0, 2000));
}
emit(out);
`
      return runEgo(code, config, { timeoutMs: args.timeoutMs ? args.timeoutMs + 30000 : undefined, vars: { ...args } })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'ego_close',
    description: `${TOOL_NOTE}\n结束任务空间并释放页面；需要把结果页面留给用户看时，用 keep 指定要保留的页面标签。`,
    parameters: {
      spaceId: { type: 'integer', required: true, description: '任务空间 id。' },
      keep: { type: 'array', items: { type: 'string' }, description: '要保留给用户的页面标签，例如 ["p1"]。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          spaceId: { type: 'integer', required: true },
          closed: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `space ${value.spaceId} closed` }],
    },
    async execute(args) {
      const code = String.raw`
const task = await taskSpace(CFG.spaceId);
await task.finish({ keep: CFG.keep || [] });
console.log(CFG.marker + JSON.stringify({ spaceId: CFG.spaceId, closed: true }));
`
      return runEgo(code, config, { vars: { spaceId: args.spaceId, keep: args.keep ?? [] } })
    },
  }))
}
