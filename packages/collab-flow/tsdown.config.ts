import { defineConfig } from 'tsdown'

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
  // 注意：具体 banner/footer 包装格式需参考
  //   packages/client/tsdown.client.ts（DSH 私有约定）
  // 在核实之前暂用标准 CJS，DSH 加载时如报错再调整
  {
    entry: { client: 'src/client.ts' },
    format: ['cjs'],
    outDir: 'lib',
    platform: 'browser',
    external: [
      /^@deepseek-ai\//,
      'react',
      'react-dom',
    ],
  },
])
