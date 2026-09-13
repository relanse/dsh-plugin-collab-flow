# AGENTS.md — AI 协作规范

本文件约束所有参与本仓库的 AI agent（包括但不限于 Claude Code、DeepSeek、GPT、Gemini 等）的行为。

---

## 一、GitHub 提交规范

### 1.1 提交信息语言

**所有 git commit message 必须使用中文。** 无例外。

### 1.2 提交格式（Conventional Commits 中文版）

```
<类型>(<范围>): <标题>

<正文（可选）>

<脚注（可选）>
```

**类型枚举：**

| 类型         | 含义                           |
| ------------ | ------------------------------ |
| `feat`     | 新功能                         |
| `fix`      | 问题修复                       |
| `refactor` | 重构（不新增功能，不修复问题） |
| `style`    | 格式调整（不影响逻辑）         |
| `test`     | 测试相关                       |
| `docs`     | 文档更新                       |
| `chore`    | 构建/工具/依赖等杂项           |
| `perf`     | 性能优化                       |
| `ci`       | CI/CD 相关                     |
| `revert`   | 回滚                           |

**范围（可选）：** 受影响的模块，例如 `projection`、`graph-builder`、`client`、`template-store`。

**示例：**

```
feat(projection): 注册 collabFlow/graph 会话投影单元

基于 DSH SessionProjection API 实现纯折叠函数，
折叠 tool-workflow/run-start、run-end 及 subagent/catalog/entry 事件，
生成 CollabGraphNode 状态快照。

支持 session 重载后从持久化事件历史恢复图状态。
```

```
fix(graph-builder): 修复 workflow/end 事件未更新节点状态的问题
```

```
docs(deep-dive): 新增 SessionProjection 技术深挖文档
```

### 1.3 提交粒度

- 每个 commit 只做一件事，不把"新增功能"和"格式调整"混在同一个 commit 里
- 新增文件时，相关的类型声明、测试和文档可以放在同一个 commit
- 不提交未完成的功能（WIP），应使用 `git stash` 暂存

---

## 二、GitHub 共同创作者规范

### 2.1 禁止在提交记录中添加 AI 共同创作者

**严格禁止**在任何 git commit message、PR description 或 GitHub 页面上出现以下任何 AI 工具的署名信息：

- `Co-authored-by: Claude` 或任何 Anthropic 产品
- `Co-authored-by: GitHub Copilot`
- `Co-authored-by: ChatGPT` 或任何 OpenAI 产品
- `Co-authored-by: Gemini` 或任何 Google 产品
- `Generated with [Claude Code]` 或类似声明
- `🤖 Generated with` 任何工具名
- 任何形式的 AI 生成声明

**所有提交的法律作者是项目的人类维护者。** AI 工具是辅助手段，不是共同作者。

### 2.2 对 AI agent 的强制指令

任何以 AI 身份操作本仓库的 agent：

1. **不得**在 commit message 末尾追加 `Co-Authored-By:` 行
2. **不得**在 PR description 末尾追加 `🤖 Generated with` 等声明
3. **必须**用中文写 commit message
4. **必须**遵守上面的 Conventional Commits 格式
5. **不得**创建包含 AI 身份信息的任何 git object

---

## 三、开源项目规范

### 3.1 代码风格

- TypeScript，严格模式（`"strict": true`）
- 函数优先于类（除非 DSH 框架要求 class）
- 导出时显式列出（不用 `export *`）
- 包内相对导入使用 `.ts` 后缀
- 注释只写"这段代码做不到的事"，不写"这段代码做了什么"

### 3.2 PR 规范

PR title 格式同 commit title，中文，带类型前缀。

PR description 模板：

```markdown
## 变更内容

<!-- 这个 PR 做了什么 -->

## 测试方式

<!-- 如何验证这个变更 -->

## 相关 issue

<!-- 关联的 issue 编号，如有 -->
```

### 3.3 Issue 规范

Issue title 中文，清晰描述问题或需求。

Bug 类 issue 需包含：

- 复现步骤
- 期望行为
- 实际行为
- DSH 版本

---

## 四、私有文档规范

`private_doc/` 目录已加入 `.gitignore`，**绝对不能提交到 GitHub**。

该目录包含：

- 开发计划书（含商业逻辑和简历材料）
- 个人学习笔记
- 面试准备材料

---

## 五、文档规范

每实现一个核心子系统，**必须**在 `docs/deep-dive/` 目录下创建对应的深挖文档，格式见 `docs/deep-dive/README.md`。

深挖文档的目的：帮助作者在面试时能够深入讲解自己写的代码。
