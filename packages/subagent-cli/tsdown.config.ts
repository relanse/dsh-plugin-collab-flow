import type { UserConfig } from 'tsdown'

export default {
  entry: { index: 'lib/types/index.js', runs: 'lib/types/runs.js' },
  outDir: 'lib',
  platform: 'node',
  target: 'es2024',
  format: 'esm',
  fixedExtension: false,
  clean: false,
  dts: false,
  deps: { neverBundle: true },
} satisfies UserConfig
