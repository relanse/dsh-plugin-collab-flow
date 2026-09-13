# CLAUDE.md — AI 使用说明

本文件约束所有在此仓库工作的 AI agent。**读完本文件再动手写代码。**

---

## 一、仓库概述

这是 `dsh-plugin-collab-flow`，一个运行在 **DeepSeek Harness (DSH)** 上的 Cordis 插件。

- 宿主平台：`C:\Users\LanSe\Desktop\dev\deepseek-harness`
- 插件包：`packages/collab-flow/`
- 技术栈：TypeScript，Cordis 插件体系，React（Client 侧）

**写代码前先读宿主平台的文档**，在 `deepseek-harness/docs/` 下，不要凭想象调用 API。

---

## 二、提交规范（强制）

所有 commit message **必须用中文**，遵循 Conventional Commits 格式：

```
<类型>(<范围>): <标题>
```

类型：`feat` / `fix` / `refactor` / `style` / `test` / `docs` / `chore` / `perf`

示例：
```
feat(graph-builder): 修正 workflow 事件字段名为真实 DSH 源码字段
fix(projection): 更正 subagent catalog 事件名为 subagent/catalog
```

**严禁**在 commit message 或 PR description 里加任何 AI 署名，包括：
- `Co-Authored-By: Claude`
- `🤖 Generated with [Claude Code]`
- 任何 AI 生成声明

---

## 三、已核实的关键 DSH API（不要再推断）

以下字段已经对照 DSH 源码核实，直接使用，不要改：

### workflow/* 事件

```typescript
// WorkflowRunInfo — packages/workflow/workflow/src/types.ts:90-95
// 只有 id 和 meta，没有 parentSessionId
interface WorkflowRunInfo {
  id: WorkflowRunId   // branded string
  meta: WorkflowMeta  // { name, description, ... }
}

// WorkflowAgentInfo — types.ts:98-107
// label 是 string（非 undefined），childId 是 SessionId
interface WorkflowAgentInfo {
  seq: number
  label: string        // 不是 optional
  phase?: string
  childId: SessionId
}

// WorkflowAgentEndInfo — types.ts:113-116
// outcome: 'completed' | 'failed' | 'cancelled'（注意是 'failed' 不是 'error'）
interface WorkflowAgentEndInfo extends WorkflowAgentInfo {
  outcome: WorkflowAgentOutcome  // 'completed' | 'failed' | 'cancelled'
}

// WorkflowResultInfo — types.ts:124-131
// stopReason: 'completed' | 'cancelled' | 'error'
```

### tool-workflow session 事件（写在父 session 日志里）

```typescript
// packages/workflow/tool-workflow/src/index.ts:119
// 'tool-workflow/run-start' payload:
{ runId: WorkflowRunId, name: string }

// packages/workflow/tool-workflow/src/index.ts:125
// 'tool-workflow/run-end' payload:
{ runId: WorkflowRunId, stopReason: WorkflowStopReason }
```

### subagent 事件

```typescript
// SubagentRunInfo — packages/subagent/subagent/src/types.ts:80-94
// 没有 parentSessionId 字段
interface SubagentRunInfo {
  runId: SubagentRunId
  provider: string
  id: SessionId   // child session id
  local: boolean
}

// SubagentRunEndInfo — types.ts:100-117
// stopReason 直接在 info 上，不是嵌套的 result.stopReason
// SubagentStopReason: 'completed' | 'aborted' | 'error' | 'max-tokens' | 'refusal'
interface SubagentRunEndInfo extends SubagentRunInfo {
  stopReason: SubagentStopReason
}

// subagent/catalog session 事件 — catalog.ts:24-32
// 事件名是 'subagent/catalog'（不是 'subagent/catalog/entry'）
// payload 没有 provider 字段
{ version: 0, childId: SessionId, childCreatedAt: number, mode: 'one-shot'|'continuable', label?: string }
```

### 父 session id 的获取方式

`workflow/*` 事件和 `subagent/*` 实时事件都不携带父 session id。

正确做法：监听 `session/event`，通过 `tool-workflow/run-start` 和 `subagent/catalog` 这两个 session 事件（写在父 session 日志里）来建立映射。代码在 `src/graph-builder.ts`。

### Storage API

```typescript
// 正确：ctx.storageDomain.open(spec)
// 错误：ctx.storage.open(domain)

// 完整调用链：
// 1. const spec = defineDomain({ name, version, tables: { ... } })
// 2. const domain = await ctx.storageDomain.open(spec)
// 3. const table = domain.table('templates')
// 4. table.get(key) // 同步读
// 5. await table.put(key, value) // 异步写
```

### Client 模块格式

`package.json` 里声明 `dsh.client: "./client"` 和 `exports["./client"]` 即可。
DSH 会自动扫描并处理 bundle 路由，不需要手写 `window.__ModuleLoader__` 包装。
tsdown.config.ts 的 client 侧只需要普通 CJS/ESM 输出，DSH 的 `ctx.clientModules` 服务负责注入。

---

## 四、架构约束

1. **不修改宿主 DSH 代码**，只通过事件和 slot 贡献
2. **Host 和 Client 之间只传 JSON-safe 数据**，通过 Remote API
3. **UI 只通过 slot 机制贡献**：`ctx.sidebarRightTabs.register()` + `sidebar.right.pane.tab` slot
4. **跨包只用 `import type`**，不导入运行时值
5. **左侧边栏没有稳定内容区 slot**，UI 入口固定走右侧 sidebar

---

## 五、待补充的依赖（下一步）

`package.json` 还缺少以下依赖，添加前需确认 DSH 版本对齐：

```json
"devDependencies": {
  "zod": "^3.x",
  "@deepseek-ai/dsh-workflow": "workspace:*",
  "@deepseek-ai/dsh-subagent": "workspace:*",
  "@deepseek-ai/dsh-session": "workspace:*",
  "@deepseek-ai/dsh-session-projection": "workspace:*",
  "@deepseek-ai/dsh-storage-domain": "workspace:*",
  "@deepseek-ai/dsh-token-meter": "workspace:*",
  "@deepseek-ai/dsh-client-ui-slots": "workspace:*",
  "@deepseek-ai/dsh-client-ui-sidebar-right": "workspace:*",
  "react": "^18.0.0",
  "@types/react": "^18.0.0"
}
```

---

## 六、私有文档

`private_doc/` 已在 `.gitignore` 里，绝对不提交。包含开发计划书和面试材料。
