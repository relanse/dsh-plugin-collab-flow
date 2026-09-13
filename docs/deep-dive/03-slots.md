# DSH Slot 机制与 UI 注入

> 对应代码：`packages/collab-flow/src/client/index.ts`
> 面试追问见 `private_doc/interview/03-slots-qa.md`

---

## 一句话总结

DSH 的 Slot 机制是 Cordis 插件体系在 UI 层的延伸——Host 侧声明"UI 插槽"，插件通过注册到命名 slot 向 DSH Web 界面注入 React 组件，不需要修改宿主代码。本插件通过 `ctx.sidebarRightTabs.register()` 注册一个右侧 sidebar tab 类型，再通过 `sidebar.right.pane.tab` slot 注入面板正文。

---

## 为什么选右侧 sidebar，不选左侧

DSH 的左侧边栏有 `sidebar.panellist` slot，可以在左侧注册图标入口，但**没有对应的内容区 slot**——点击左侧图标会打开什么内容，由 DSH 自己的路由决定，插件无法注入。

右侧 sidebar 是 DSH 专门为插件设计的内容扩展点：
- `ctx.sidebarRightTabs.register()` — 声明一个 tab 类型（定义 id、kind、标题、引导信息）
- `sidebar.right.pane.tab` keyed slot — 注入对应 kind 的面板正文组件

这两个一起用，插件就有了一个完整的"有入口 + 有内容"的 UI 区域。

---

## Cordis 插件的 Host + Client 双半边

DSH 的 Cordis 插件可以有两个运行环境：

**Host 半边**（Node.js 进程）：注册服务、监听事件、访问文件系统和数据库。入口是 `src/index.ts`，导出 `name / inject / apply`，通过 `package.json` 的 `main` 字段加载。

**Client 半边**（浏览器）：注册 UI 组件、slot、sidebar tab。入口是 `src/client/index.ts`，通过 `package.json` 的 `exports["./client"]` 和 `dsh.client` 字段声明。构建产物必须以 `window.__ModuleLoader__.load({ id, factory })` 注册懒加载工厂；DSH 的 `ctx.clientModules` 服务扫描已加载包的 `dsh.client` 字段，自动把 `lib/client.js` 加入 `window.__DSH_BOOT__` 启动图，在页面加载时注入。

两个半边在各自的 Cordis 上下文里运行，通过 Remote API 通信（Host 暴露方法，Client 通过 `window.__dsh_remote__` 调用）。

---

## slot 注册的技术细节

```typescript
// 1. 注册 tab 类型——告诉 DSH "有这种 tab"
ctx.sidebarRightTabs.register({
  id: '@dsh-community/collab-flow',   // 唯一 id，用 package name 避免冲突
  kind: 'collab-flow',                // kind 是 slot 匹配的 key
  priority: 'extension',
  title: () => 'Collab Flow',         // 函数形式支持响应式国际化
  guide: {
    order: 50,                        // 在引导列表里的排序
    title: () => 'Collab Flow',
    description: () => '多 Agent 协作可视化',
  },
})

// 2. 注入面板正文——把 React 组件绑到这个 tab kind
ctx.slots.inject('sidebar.right.pane.tab', () =>
  ctx.slots.register(
    {
      name: 'sidebar.right.pane.tab',
      key: '@dsh-community/collab-flow',  // key 匹配上面注册的 id
    },
    CollabFlowPanel,
  )
)
```

`ctx.effect(() => ..., 'label')` 包裹这些注册调用，确保插件卸载时自动注销——这是 Cordis 的生命周期管理机制，effect 的返回值（或 disposer）在 fiber dispose 时被调用。

---

## 为什么用 `ctx.effect` 而不是直接调用

Cordis 的 `ctx.effect()` 把副作用（注册某个服务/slot）绑定到当前 fiber 的生命周期：

- fiber 激活时，effect 执行，副作用生效
- fiber 停用（插件热重载、profile 切换）时，effect 的 disposer 自动调用，副作用撤销

如果直接调用 `sidebarRightTabs.register()` 而不包在 effect 里，插件被卸载时 tab 类型会继续存在于 DSH 界面里，但背后的 fiber 已经停了——用户点击这个 tab 会报错或行为异常。

---

## Client 组件的打包

`src/client/index.ts` 静态导入面板组件，客户端构建将其与运行态视图、模板库和 CSS
合并为一个 `lib/client.js`。这是官方 client-modules 的发布约定：bundle 执行时只向
`window.__ModuleLoader__` 注册工厂，模块主体在 Harness 物化工厂时运行。插件不能依赖
额外的未经注册 chunk 路径。

面板组件仍然只在对应 slot 被渲染时才执行，bundle 本身只完成工厂注册，不会提前运行
面板副作用。

---

## 已知限制

**Remote API 调用方式未核实**：`src/client/live-view.tsx` 和 `template-list.tsx` 里用了 `(window as any).__dsh_remote__?.collab` 来调用 Host 的方法。这是推断的调用方式，实际的 Remote 注册和调用约定需要参考 DSH 的 `packages/api/remotes/` 文档。如果 DSH 用的是 `@Remote` 装饰器 + 类型安全的调用方式，这里的代码需要更新。

**slot API 字段名未最终核实**：`sidebar.right.pane.tab` slot 名称和 `ctx.sidebarRightTabs.register()` 的参数结构基于文档推断，上线前需对照 `packages/client/` 里的实际 slot 定义确认。
