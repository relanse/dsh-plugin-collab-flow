import { readFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { typertPlugin } from '@deepseek-ai/dsh-typert-generator/tsdown'
import { transform } from 'lightningcss'
import type { UserConfig } from 'tsdown'

const PACKAGE_ID = '@dsh-community/plugin-collab-flow'
const SHARED_MODULES = new Set([
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client',
  '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
])
const CSS_PREFIX = '\0collab-flow-css:'

function clientStyles(): NonNullable<UserConfig['plugins']>[number] {
  return {
    name: 'collab-flow-client-styles',
    resolveId(source, importer) {
      if (!source.endsWith('.css') || importer === undefined) return null
      return CSS_PREFIX + resolve(dirname(importer), source) + '.mjs'
    },
    async load(id) {
      if (!id.startsWith(CSS_PREFIX)) return null
      const filename = id.slice(CSS_PREFIX.length, -4)
      this.addWatchFile(filename)
      const { code } = transform({ filename, code: await readFile(filename), minify: true })
      const styleId = PACKAGE_ID + '/' + basename(filename)
      const selector = 'style[data-plugin-css=' + JSON.stringify(styleId) + ']'
      return [
        'if (typeof document !== "undefined" && document.querySelector(' + JSON.stringify(selector) + ') === null) {',
        '  const style = document.createElement("style");',
        '  style.dataset.pluginCss = ' + JSON.stringify(styleId) + ';',
        '  style.dataset.plugin = ' + JSON.stringify(PACKAGE_ID) + ';',
        '  style.textContent = ' + JSON.stringify(code.toString()) + ';',
        '  document.head.appendChild(style);',
        '}',
      ].join('\n')
    },
  }
}

export default (input: { env?: Record<string, unknown> }): UserConfig => {
  if (input.env?.DSH_BUILD_FACE === 'host') {
    return {
      name: PACKAGE_ID,
      entry: ['lib/types/index.js'],
      outDir: 'lib',
      platform: 'node',
      target: 'es2024',
      format: 'esm',
      fixedExtension: false,
      clean: false,
      dts: false,
      deps: { neverBundle: true },
      plugins: [typertPlugin({ mode: 'package', faces: ['host'] })],
    }
  }

  return {
    name: PACKAGE_ID + '/client',
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    platform: 'browser',
    target: 'es2024',
    format: 'cjs',
    clean: false,
    dts: false,
    sourcemap: true,
    deps: {
      neverBundle: (specifier: string) => SHARED_MODULES.has(specifier),
      alwaysBundle: (specifier: string) => !SHARED_MODULES.has(specifier),
    },
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    plugins: [clientStyles()],
    outputOptions: {
      entryFileNames: 'client.js',
      banner: 'window.__ModuleLoader__.load({ id: ' + JSON.stringify(PACKAGE_ID) + ', factory: (require) => { const module = { exports: {} }; const exports = module.exports;',
      footer: 'return module.exports; } });',
    },
  }
}
