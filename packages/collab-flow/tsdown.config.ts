import { defineConfig } from 'tsdown'

const clientId = '@dsh-community/plugin-collab-flow'

export default defineConfig([
  // ── Host 侧：Node.js ESM ──────────────────────────────────────
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    dts: { outDir: 'lib/types' },
    outDir: 'lib',
    platform: 'node',
    external: [
      /^@deepseek-ai\//,
    ],
  },
  // ── Client 侧：Browser CJS（DSH ModuleLoader 工厂格式）──────────
  // DSH 的 client-modules registry 执行 bundle 只应注册工厂；模块主体
  // 在 Harness 物化该工厂时运行。发布包只提供 client.js，因此所有
  // client-side dynamic imports 必须在这里合并为单个资源。
  {
    entry: { client: 'src/client/index.ts' },
    format: ['cjs'],
    outDir: 'lib',
    platform: 'browser',
    target: 'es2024',
    clean: false,
    sourcemap: true,
    external: [
      /^@deepseek-ai\//,
      'react',
      'react-dom',
    ],
    outputOptions: {
      entryFileNames: 'client.js',
      inlineDynamicImports: true,
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(clientId)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
