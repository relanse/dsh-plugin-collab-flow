# dsh-plugin-collab-flow

DSH（DeepSeek Harness）的多 Agent 协作可视化插件。

在右侧 sidebar 面板里实时展示当前 session 里主/子 agent 的协作过程，并提供可复用的 Workflow 脚本模板库。

---

## 功能

- **运行态投影**：实时展示 workflow run、phase、subagent 的层级树，显示状态、耗时、token 用量（进程内 agent）
- **模板库**：创建、编辑、删除 Workflow 脚本模板，跨 session 持久保存
- **一键启动**：从模板库直接触发 DSH workflow，无需手动写脚本

## 安装

本插件需要 DSH Web profile（2026-07 以上版本）。

```sh
dsh plugin install @dsh-community/plugin-collab-flow
```

安装后在 DSH 右侧 sidebar 点击 "Collab Flow" 入口，或通过命令 `openTab('collab-flow')` 打开。

## 前提条件

- 使用 Claude Code / Codex 子 agent 时，需要在 DSH profile 中启用对应的 provider
- workflow 模板功能需要 DSH profile 启用 `workflowEngine`（`dsh-base` 默认包含）

## 已知限制

- 进程外子 agent（claude-code、codex）的 token 用量无法读取，显示为 `token: —`
- 运行态视图采用 1 秒轮询，有约 1 秒延迟
- workflow 脚本在保存时不做语法校验，语法错误在运行时才报告

## 开发

```sh
# 安装依赖
pnpm install

# 构建
pnpm run build

# 类型检查
pnpm run typecheck

# 加载到 DSH
dsh --profile web --plugin ./packages/collab-flow
```

## 项目结构

```
packages/collab-flow/src/
  index.ts           # Host 入口
  client/index.ts    # Client 入口（注册 sidebar tab）
  types.ts           # Host/Client 共享类型（JSON-safe）
  projection.ts      # DSH SessionProjection 折叠单元
  graph-builder.ts   # 实时图构建器
  template-store.ts  # 模板持久化存储
  client/
    panel.tsx         # 面板根组件
    live-view.tsx     # 运行态节点树
    template-list.tsx # 模板库
    template-editor.tsx # 创建/编辑模板
```

## 提交规范

所有 commit message 使用中文，遵循 Conventional Commits 格式，详见 [AGENTS.md](./AGENTS.md)。

## License

MIT
