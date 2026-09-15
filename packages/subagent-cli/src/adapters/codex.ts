import type { HarnessAdapter, HarnessTranscript, ProtocolLimits } from '../adapter.ts'
import { CliFailure } from '../failure.ts'
import { counter, createJsonLines, identity, jsonRecord } from '../jsonl.ts'
import type { CliUsage } from '../types.ts'

export function createCodexTranscript(limits?: ProtocolLimits): HarnessTranscript {
  let session: string | undefined, text = '', ended = false, done = false, failed = false, interrupted = false
  let snapshot: CliUsage | undefined, completion: string | undefined
  const lines = createJsonLines(event => {
    if (typeof event.type !== 'string') throw new CliFailure('invalid-event')
    if (event.type === 'thread.started') {
      const id = identity(event.thread_id)
      if (session !== undefined && session !== id) throw new CliFailure('session-mismatch')
      session = id
    } else if (event.type === 'turn.started') {
      if (done) throw new CliFailure('invalid-event')
    } else if (event.type === 'turn.failed') {
      failed = true
    } else if (event.type === 'error') {
      interrupted = true
    } else if (event.type.startsWith('item.')) {
      const item = jsonRecord(event.item)
      if (typeof item.type !== 'string') throw new CliFailure('invalid-event')
      if (item.type === 'collab_tool_call') throw new CliFailure('nested-delegation')
      if (done) throw new CliFailure('invalid-event')
      if (event.type === 'item.completed' && item.type === 'agent_message') {
        identity(item.id)
        if (typeof item.text !== 'string') throw new CliFailure('invalid-event')
        if (item.text.trim() !== '') text = item.text
      }
    } else if (event.type === 'turn.completed') {
      const serialized = JSON.stringify(event)
      if (completion !== undefined) {
        if (completion !== serialized) throw new CliFailure('invalid-event')
        return
      }
      completion = serialized
      done = true
      if (event.usage === undefined || event.usage === null) return
      const usage = jsonRecord(event.usage)
      const input = counter(usage.input_tokens), output = counter(usage.output_tokens), cacheRead = counter(usage.cached_input_tokens)
      if (input === undefined || output === undefined || !Number.isSafeInteger(input + output) || (cacheRead !== undefined && cacheRead > input)) return
      snapshot = { input, output, total: input + output, ...(cacheRead === undefined ? {} : { cacheRead }),
        reportedSteps: 1, observedSteps: 1, complete: true, source: 'codex/turn.completed', scope: 'turn', inputIncludesCache: true }
    }
  }, limits)
  const terminal = (): 'completed' | 'failed' | 'incomplete' => failed || (interrupted && !done) ? 'failed' : ended && done && session !== undefined ? 'completed' : 'incomplete'
  return {
    push: lines.push, end() { lines.end(); ended = true }, externalSessionId: () => session,
    output: () => text === '' ? [] : [{ type: 'text', text }], terminal,
    usage: () => snapshot === undefined ? undefined : { ...snapshot, complete: terminal() === 'completed' },
  }
}

export const codexAdapter: HarnessAdapter = {
  apiVersion: 1, id: 'codex', defaultExecutable: 'codex',
  leafPolicy: { enforced: true, description: 'Both Codex multi-agent features are disabled for every run.' },
  invocation({ prompt, config }) {
    const args = ['exec', '--json', '--ephemeral', '--skip-git-repo-check', '--color', 'never',
      '-c', 'approval_policy="never"', '--sandbox', config.permissionMode === 'deny' ? 'read-only' : 'workspace-write',
      '--disable', 'multi_agent', '--disable', 'multi_agent_v2', '--disable', 'plugins', '--disable', 'hooks', '--disable', 'apps']
    if (config.pure) args.push('--ignore-user-config', '--ignore-rules', '--disable', 'skill_mcp_dependency_install', '-c', 'project_doc_max_bytes=0')
    if (config.permissionMode === 'deny') args.push('--disable', 'shell_tool', '--disable', 'unified_exec',
      '--disable', 'browser_use', '--disable', 'computer_use', '--disable', 'image_generation', '-c', 'web_search="disabled"')
    if (config.model !== undefined) args.push('--model', config.model)
    if (config.variant !== undefined) args.push('-c', 'model_reasoning_effort=' + JSON.stringify(config.variant))
    args.push('-')
    return { args, stdin: prompt }
  },
  transcript: createCodexTranscript,
}
