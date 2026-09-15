import { delegationDepthOf } from '@deepseek-ai/dsh-subagent'
import type { ResolvedSubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { CliFailure } from './failure.ts'

export const CLI_CHILD_ENV = 'COLLAB_FLOW_CLI_CHILD'

export function assertLeafDelegation(request: ResolvedSubagentStartRequest): void {
  if (request.signal.aborted) throw new CliFailure('cancelled')
  if (process.env[CLI_CHILD_ENV] !== undefined) throw new CliFailure('recursive-entry')
  const durableDepth = request.parent.session.header.delegationDepth
  if (durableDepth !== undefined && (!Number.isSafeInteger(durableDepth) || durableDepth < 0 || Object.is(durableDepth, -0))) throw new CliFailure('invalid-delegation-state')
  let depth: number
  try { depth = delegationDepthOf(request.parent) } catch { throw new CliFailure('invalid-delegation-state') }
  if (!Number.isSafeInteger(depth) || depth < 0) throw new CliFailure('invalid-delegation-state')
  if (depth > 0 || request.parent.session.header.origin === 'subagent') throw new CliFailure('nested-delegation')
}
