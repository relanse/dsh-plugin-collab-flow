import type { UserConfig } from 'tsdown'

export default {
  entry: ['lib/types/index.js'],
  outDir: 'lib',
  platform: 'node',
  target: 'es2024',
  format: 'esm',
  fixedExtension: false,
  clean: false,
  dts: false,
  deps: { neverBundle: true },
} satisfies UserConfig
