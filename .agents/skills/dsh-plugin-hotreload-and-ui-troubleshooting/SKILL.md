---
name: dsh-plugin-hotreload-and-ui-troubleshooting
category: 架构与设计
tags: [dsh, cordis, esm-cache, hot-reload, shell-overlay, json-bridge]
description: 【架构与设计】DSH Desktop / Cordis 插件热重载 ESM 缓存冲突（SyntaxError: does not provide an export named）、HTTP 桥接空响应（Unexpected end of JSON input）与右侧常驻控制台（shell.overlay）排查与修复规范
---

# DSH Desktop 插件热重载与常驻控制台故障排查（DSH Plugin Hot-Reload & UI Troubleshooting）

## 适用场景（When to Use）
在开发、重构或热更新 DeepSeek Harness（`dsh` / Cordis）多入口插件包（如包含 `./store`、`./ui`、`./tools`、`./client` 的单包插件）并安装到 DSH Desktop（`~/.dsh/profiles/desktop`）时，若出现以下任一现象，立即调用本技能：
1. **插件热更新激活失败**：`dsh: warning: 1 entry did not activate <plugin>-ui: failed to import: SyntaxError: The requested module './settings.js' does not provide an export named '<SYMBOL>'`
2. **右侧控制台报红字 JSON 解析错误**：`Unexpected end of JSON input`
3. **安装后右侧控制台或唤起按钮不可见**：`shell.overlay` 被裁切或高度坍缩

---

## 一、ESM 模块缓存冲突（`SyntaxError: does not provide an export named ...`）

### 1. 根因分析
- Node.js 的 ESM 加载器在进程生命周期内按解析后的 `file://` URL 将模块缓存在内存中。
- 若更新插件代码但**未升级 `package.json` 的 `version`**，`pnpm add https://github.com/<owner>/<repo>` 会解压覆盖到完全相同的 `.pnpm/<pkg>@<version>/node_modules/<pkg>/` 路径下。
- 当 DSH Desktop 热重载 `<pkg>/ui`（`lib/ui.js`）时，Node.js 的 ESM 链接器会将新版 `lib/ui.js` 与**内存中已由 `<pkg>/store` 缓存的旧版 `./settings.js` 或 `./store-core.js`** 进行静态具名符号绑定。
- 静态具名导入（`import { NEW_EXPORT } from './settings.js'`）在 **ESM 链接期**（任何业务代码执行前）即校验导出表，一旦内存中旧模块没有该新增导出，立即抛出 `SyntaxError`。

### 2. 标准修复方案
1. **跨模块导入全面改用 ESM 命名空间导入（`import * as ...`）+ 本地兜底**：
   在 `ui/lib/index.js`（`lib/ui.js`）和 `store/lib/core.js`（`lib/store-core.js`）中，用 `import * as ns` 替代具名导入，并提供行内兜底实现：
   ```js
   import * as settingsMod from './settings.js'
   import * as coreMod from './store-core.js'

   const DEFAULT_MAX_DEPTH = settingsMod.DEFAULT_MAX_DEPTH ?? 3
   const maxDepthOf = settingsMod.maxDepthOf || ((root) => 3)
   const getPgWriteProbe = coreMod.getPgWriteProbe || (() => ({
     snapshot: () => ({ mode: 'wal', totalWrites: 0, writeRatePerMin: 0, tables: [], recentEvents: [] }),
   }))
   ```
   > **原理**：`import * as ns` 在 ESM 链接阶段只绑定模块命名空间对象，不在链接期校验单个具名导出，从而对内存中残留的旧版模块缓存 100% 免疫。

2. **对长生命周期单例服务（`ctx.<service>`）的新方法做存在性守卫**：
   热重载时 `ctx.redteam` 等进程级单例可能仍是旧版实例，调用新增方法前必须检查 `typeof store.newMethod === 'function'` 并提供待机兜底返回值：
   ```js
   if (store && typeof store.workflowDag === 'function') {
     return Object.assign({ ok: true }, store.workflowDag(activeEngagement))
   }
   return { ok: true, standby: true, nodes: [], edges: [], activeRoles: [], docWall: [] }
   ```

3. **每次改动导出面或入口时同步升级 `package.json` 版本号**：
   同时升级根目录 `package.json` 与 `packages/redteam-bundle/package.json` 的 `"version"`，迫使 `pnpm add` 落入全新的 `.pnpm/<pkg>@<new-version>` 目录，生成全新的 `file://` URL。

---

## 二、前端 HTTP 桥接报 `Unexpected end of JSON input`

### 1. 根因分析
- 当宿主侧 `ui` 插件尚未激活或正在热重载时，`POST /redteam/api` 会返回空响应体（HTTP 404/502）。
- 前端直接调用 `fetch('/redteam/api', ...).then((res) => res.json())` 对空字符串执行 `res.json()` 会抛出 `SyntaxError: Unexpected end of JSON input`。
- 若 `bootstrap` 直接调用 `setErr(...)`，根组件 `Panel` 会将整个工作台替换为 `<div class="rt-err">{err}</div>`。

### 2. 标准修复方案
1. **在 `api(req)` 中先读取 `res.text()` 再安全解析 JSON（同时兼容单元测试桩的 `res.json()`）**：
   ```js
   const api = (req) => fetch('/redteam/api', {
     method: 'POST',
     headers: { 'content-type': 'application/json' },
     body: JSON.stringify(req),
   }).then((res) => {
     if (res && typeof res.text === 'function') {
       return res.text().then((txt) => {
         if (!txt || !txt.trim()) {
           return { ok: false, emptyResponse: true, error: '后端服务正在就绪，请稍候点击「刷新」重试' }
         }
         try {
           return JSON.parse(txt)
         } catch {
           return { ok: false, emptyResponse: true, error: '后端响应格式异常（HTTP ' + (res.status || 0) + '）' }
         }
       })
     }
     return res && typeof res.json === 'function' ? res.json() : { ok: false, error: '未知响应' }
   })
   ```
2. **空响应静默待机**：
   在 `Panel` 的 `bootstrap` 初始化中，若返回 `r && r.emptyResponse`，不触发全局 `setErr`，保留本地 DOM 会话遥测与总览面板渲染；并在 `refreshAll()` 中主动执行 `setErr(null)`。

---

## 三、DSH Desktop 右侧控制台不可见或被裁切

### 1. 根因分析
- DSH Desktop 的 `shell.overlay` 槽位挂载在零高度覆盖层容器中，使用 `position: relative` 会导致侧边栏被挤出视口或高度为 0。
- 空白主页下 `session.header.actions` 可能不渲染，若收起侧栏后不保留浮动唤起胶囊，用户将无法再次打开控制台。

### 2. 标准修复方案
1. **固定定位右侧侧边栏并避让桌面标题栏**：
   ```css
   .rt-dock {
     position: fixed;
     top: var(--dsh-frame-chrome-top, 0px);
     right: 0;
     bottom: 0;
     height: calc(100vh - var(--dsh-frame-chrome-top, 0px));
     z-index: 90;
   }
   ```
2. **收起状态下常驻右下角 `.rt-fab` 唤起胶囊**：
   在 `shell.overlay` 渲染函数中，当 `open === false` 时渲染 `position: fixed; right: 16px; bottom: 20px; z-index: 95` 的悬浮按钮，确保任何界面下均可一键呼出控制台。

---

## 四、发布前必跑构建与回归验证命令
```bash
node packages/redteam-bundle/tools/build.mjs
cp -r packages/redteam-bundle/lib packages/redteam-bundle/presets packages/redteam-bundle/cordis.patch.yml .
node packages/redteam-bundle/tools/build.mjs --check
node packages/redteam-bundle/tools/test-all.mjs
```
