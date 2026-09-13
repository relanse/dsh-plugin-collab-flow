import { clientBundle } from '../../../deepseek-harness/packages/client/tsdown.client.ts'
import { typertPlugin } from '../../../deepseek-harness/packages/typert/generator/lib/types/tsdown-plugin.js'
import type { UserConfig } from 'tsdown'

/** Shared browser identities seeded by the Harness Web shell. */
const CLIENT_SHARED_MODULES = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
])

const bundle = clientBundle(
  '@dsh-community/plugin-collab-flow',
  ['lib/types/index.js'],
  {
    hostPhase: true,
    lib: {
      plugins: [typertPlugin({ mode: 'package', faces: ['host'] })],
    },
  },
)

/**
 * The shared preset's dependency classifier scans the Harness monorepo. This
 * package is intentionally out-of-tree, so use the same platform boundary
 * while letting the package's generated Remote contribution stay inline.
 */
export default (input: { env?: Record<string, unknown> }): UserConfig[] => bundle(input).map(config => {
  const isClient = config.name === '@dsh-community/plugin-collab-flow/client'
  return {
    ...config,
    deps: {
      neverBundle: true,
      ...(isClient ? { alwaysBundle: (specifier: string) => !CLIENT_SHARED_MODULES.has(specifier) } : {}),
    },
    plugins: config.plugins?.filter(plugin => plugin.name !== 'dsh-client-bundle-purity'),
  }
})
