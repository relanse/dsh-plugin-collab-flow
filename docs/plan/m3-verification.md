# M3 验收记录

M3 实现多 harness 的持久化单次叶子委派：OpenCode、Claude Code、Codex CLI，以及管理员提供的本地自定义适配器。原计划中的“暂不实现其他 CLI”范围已按本次用户要求扩展。

## 验证环境

Windows、Node 22.23.1、pnpm 11.21.0、DSH 0.1.5-rc.2。CLI 参数核对版本为 OpenCode 1.18.30、Claude Code 2.1.269、Codex CLI 0.154.0-alpha.6.2。

## 自动验收

| 检查 | 结果 |
|---|---|
| pnpm clean → pnpm test | 冷构建通过；CLI 70 项 + collab-flow 19 项 = 89 项，0 失败、0 跳过 |
| pnpm typecheck | 全 workspace 通过 |
| pnpm lint | 33 个源文件，0 warning、0 error |
| pnpm install --frozen-lockfile | 通过 |
| CLI 发布包 | 44 个文件；包含 runtime 分块、类型、patch、README 和两个自定义示例；无 tests/scripts/private_doc |
| 解包运行 | 解包后的主入口、记录服务和自定义适配器均成功导入 |
| 服务契约 | 正式插件要求持久化 writer v2；collab-flow 读取 v1/v2，缺失服务降级保持原图 |
| 跨包方向 | collab-flow 对 CLI 包仅 type import，通过可选服务访问 |

## 持久化与生命周期

- 使用真实 JsonStorageBackend + DomainFacility 写入 pending/running/finished，关闭并重新打开后恢复 finished 的状态和完整 usage。
- 真正 OS 子进程在确认写入后直接退出；另一个进程上下文重开同一介质，未完成记录标记 interrupted-by-restart，完成记录与用量保留。
- 不恢复 PID、不调用模型、不自动续跑；再次打开不会重新改写已经修复的结束时间。
- 存储写入确认前读缓存不更新；输入事件和输出快照均防御性复制。
- 写入失败、挂起和坏记录测试证明不会静默退回内存；准备失败不 spawn，started 失败先清理，终态失败返回安全错误并停止新准入。
- 记录不包含原始 prompt、输出正文、stderr 或环境。测试检查持久化内容不出现固定输入/输出标记。
- 保留并验证 M2 的递归身份、深度、子进程标记、启动期并发容量和清理失败保护。
- 真正 DSH subprocess 验证 stdin、敏感环境清理、取消后 CLI 与后代退出。没有运行真实循环代理。

## 多 harness 与自定义接口

| 项目 | 覆盖 |
|---|---|
| OpenCode | 既有真实 JSONL 样本；步骤去重、最终文本和 task 禁用；本轮真实模型成功返回 COLLAB_M3_OK，CLI 自报 3,657 / 7 / 3,664 |
| Claude Code | 根据官方 result/assistant/system 结构构造协议样本，覆盖 modelUsage、主循环 fallback、缓存分类、去重、错误及 Agent/Task 拒绝；本机未登录，真实模型成功路径未验收 |
| Codex CLI | thread/item/turn 协议样本、聚合用量、缓存子集、取消、跨会话拒绝；真实 CLI 能启动并输出协议事件，模型上游返回 503 后触发 429，未取得成功答案 |
| Codex 重连 | 实际观察到重连 error 消息，新增 error 后成功 turn.completed 的回归，避免将已恢复的连接判为失败 |
| 自定义模块 | 绝对本地路径、API 版本和 leafPolicy 校验；不能覆盖共享子进程标记及输出上限；可运行 echo 示例通过真正 DSH 受管进程测试 |

两种新增 CLI 的成功答复、usage 解析通过确定性协议样本验证；以上原生调用限制不是成功验收记录。没有替换本机模型、写入凭据、改动日常 DSH profile 或创建 PR。

Codex pure=true 忽略用户配置，可能失去自定义提供方；保留原生模型路由的路径也已尝试，失败原因为已配置上游通道不可用。CLI 的 MCP 空表参数实测会合并，所以实现和文档没有宣称它能清空 MCP。

## 复现入口

~~~powershell
pnpm install --frozen-lockfile
pnpm clean
pnpm test
pnpm typecheck
pnpm lint
pnpm --filter @dsh-community/plugin-subagent-cli pack --pack-destination D:/Temp/m3-pack
~~~

真实模型调用属于 opt-in，按 [CLI 包文档](../../packages/subagent-cli/README.md) 选择已登录的 CLI、模型与权限模式后执行 probe。需要验证新的 CLI 版本时重新核对 flags 与协议；默认测试不消耗模型额度。

## 边界与后续

- M3 验证了存储后端跨进程恢复及图合并契约；本轮没有重复 M2 的完整浏览器交互验收。
- 只支持 one-shot；不中断后续转为隐式重试，不实现 resume、进程池、动态模型选路或后台继续。
- 磁盘保留历史，list 默认按父会话取最近 200 条结束记录；海量历史归档留作后续。
- Claude 的原生成功调用待登录可用；Codex 的原生成功调用待现有模型通道恢复。两者未被伪报为通过。
- M4 继续处理安装/卸载、发行兼容矩阵及发布验收。
