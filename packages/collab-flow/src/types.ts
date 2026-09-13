/**
 * Host/Client 共享类型定义
 *
 * 约束：
 * - 只含 JSON-safe 类型，绝不 import 任何 DSH 运行时包
 * - Host 和 Client 都可以安全引用这个文件
 */

// ── 协作图节点 ────────────────────────────────────────────────

export type NodeKind =
  | 'root-agent'      // session 顶层 agent
  | 'workflow-run'    // 一次 workflow 脚本执行
  | 'workflow-phase'  // workflow 内的 phase（分组，无独立进程）
  | 'subagent'        // 委派子 agent（进程内或进程外）

export type NodeStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'cancelled'
  | 'error'

/**
 * 一个协作图节点，代表一次 agent 运行或 workflow run 或 phase。
 *
 * tokens 字段说明：
 * - 仅进程内 agent（spawn-in-process / fork-in-process）有值
 * - 进程外 claude-code / codex 此字段永远为 undefined（外部进程，DSH ctx.llm 无法观测）
 */
export interface CollabGraphNode {
  id: string
  kind: NodeKind
  label: string
  status: NodeStatus
  parentId?: string | undefined
  /** 子 agent 来源：'claude-code' | 'codex' | 'spawn-in-process' | 'fork-in-process' | 'dsh-sdk' */
  provider?: string | undefined
  startedAt: number
  endedAt?: number | undefined
  tokens?: { input: number; output: number; total: number } | undefined
  phaseTitle?: string | undefined
  workflowName?: string | undefined
  error?: string | undefined
}

/** 整个协作图快照（Client 端只读视图） */
export interface CollabGraph {
  sessionId: string
  nodes: CollabGraphNode[]
  /** parentId → childId[] 索引，Client 渲染用 */
  childrenOf: Record<string, string[]>
  runningCount: number
  updatedAt: number
}

// ── 工作流模板 ────────────────────────────────────────────────

export interface WorkflowTemplateMeta {
  name: string
  description: string
  whenToUse?: string | undefined
  phases?: Array<{ title: string; detail?: string | undefined }> | undefined
}

export interface WorkflowTemplate {
  id: string
  name: string
  description: string
  /** 实际 workflow 脚本内容，对应 WorkflowStartRequest.script */
  script: string
  /** 随 script 一起传给 workflowEngine 的 meta 块 */
  meta: WorkflowTemplateMeta
  tags: string[]
  createdAt: number
  updatedAt: number
}

/** JSON values accepted as workflow launch arguments. */
export type WorkflowArgs = Record<string, string | number | boolean | null>

// ── Remote API 契约（Host ↔ Client） ─────────────────────────
// Host 方法上的 @Remote 会从这些公开类型生成严格 wire schema。

export interface CollabRemoteApi {
  /** 读取当前 session 的协作图快照 */
  getGraph(sessionId: string): CollabGraph | null
  /** 列出所有模板 */
  listTemplates(): WorkflowTemplate[]
  /** 保存（新建或更新）模板 */
  saveTemplate(tpl: WorkflowTemplate): Promise<void>
  /** 删除模板 */
  deleteTemplate(id: string): Promise<void>
  /**
   * 用某个模板启动 workflow。
   * Host 侧调用 ctx.workflowEngine.start()，不阻塞等待完成。
   */
  launchTemplate(sessionId: string, templateId: string, args?: unknown): Promise<void>
}
