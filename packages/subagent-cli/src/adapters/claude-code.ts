import type { HarnessAdapter, HarnessTranscript, ProtocolLimits } from '../adapter.ts'
import { CliFailure } from '../failure.ts'
import { counter, createJsonLines, identity, jsonRecord } from '../jsonl.ts'
import type { CliUsage } from '../types.ts'

function resultUsage(event: Record<string, unknown>): CliUsage | undefined {
  const models = event.modelUsage
  const fromModels = models !== null && typeof models === 'object' && !Array.isArray(models) && Object.keys(models).length > 0
  const reports = fromModels ? Object.values(models) : [event.usage]
  let input = 0, output = 0, cacheRead = 0, cacheWrite = 0
  for (const report of reports) {
    if (report === null || typeof report !== 'object' || Array.isArray(report)) return undefined
    const value = report as Record<string, unknown>
    const i = counter(value[fromModels ? 'inputTokens' : 'input_tokens'])
    const o = counter(value[fromModels ? 'outputTokens' : 'output_tokens'])
    const r = counter(value[fromModels ? 'cacheReadInputTokens' : 'cache_read_input_tokens'])
    const w = counter(value[fromModels ? 'cacheCreationInputTokens' : 'cache_creation_input_tokens'])
    if (i === undefined || o === undefined || r === undefined || w === undefined) return undefined
    input += i + r + w; output += o; cacheRead += r; cacheWrite += w
  }
  if (![input, output, input + output, cacheRead, cacheWrite].every(Number.isSafeInteger)) return undefined
  return { input, output, total: input + output, cacheRead, cacheWrite, reportedSteps: 1, observedSteps: 1,
    complete: true, source: fromModels ? 'claude-code/result.modelUsage' : 'claude-code/result.usage',
    scope: fromModels ? 'run' : 'turn', inputIncludesCache: true }
}

export function createClaudeCodeTranscript(limits?: ProtocolLimits): HarnessTranscript {
  let session: string | undefined, text = '', ended = false, done = false, failed = false
  let snapshot: CliUsage | undefined, result: string | undefined
  const lines = createJsonLines(event => {
    if (typeof event.type !== 'string') throw new CliFailure('invalid-event')
    if (!['system', 'assistant', 'result'].includes(event.type)) return
    if (event.type === 'system' && event.subtype !== 'init') return
    const id = identity(event.session_id)
    if (session !== undefined && session !== id) throw new CliFailure('session-mismatch')
    session = id
    if (event.parent_tool_use_id !== undefined && event.parent_tool_use_id !== null) throw new CliFailure('nested-delegation')
    if (event.type === 'assistant') {
      if (done) throw new CliFailure('invalid-event')
      const message = jsonRecord(event.message)
      if (!Array.isArray(message.content)) throw new CliFailure('invalid-event')
      const parts: string[] = []
      for (const raw of message.content) {
        const part = jsonRecord(raw)
        if (part.type === 'tool_use' && (part.name === 'Agent' || part.name === 'Task')) throw new CliFailure('nested-delegation')
        if (part.type === 'text') {
          if (typeof part.text !== 'string') throw new CliFailure('invalid-event')
          parts.push(part.text)
        }
      }
      if (parts.join('').trim() !== '') text = parts.join('\n')
      if (event.error !== undefined) failed = true
    } else if (event.type === 'result') {
      const serialized = JSON.stringify(event)
      if (result !== undefined) {
        if (result !== serialized) throw new CliFailure('invalid-event')
        return
      }
      if (typeof event.subtype !== 'string' || typeof event.is_error !== 'boolean') throw new CliFailure('invalid-event')
      result = serialized; done = true
      failed ||= event.subtype !== 'success' || event.is_error || (event.terminal_reason !== undefined && event.terminal_reason !== 'completed')
      if (typeof event.result === 'string' && event.result.trim() !== '') text = event.result
      snapshot = resultUsage(event)
    }
  }, limits)
  const terminal = (): 'completed' | 'failed' | 'incomplete' => failed ? 'failed' : ended && done ? 'completed' : 'incomplete'
  return {
    push: lines.push, end() { lines.end(); ended = true }, externalSessionId: () => session,
    output: () => text === '' ? [] : [{ type: 'text', text }], terminal,
    usage: () => snapshot === undefined ? undefined : { ...snapshot, complete: terminal() === 'completed' },
  }
}

export const claudeCodeAdapter: HarnessAdapter = {
  apiVersion: 1, id: 'claude-code', defaultExecutable: 'claude',
  leafPolicy: { enforced: true, description: 'Claude Code Agent and legacy Task tools are always disallowed.' },
  invocation({ prompt, config }) {
    const args = ['--print', '--input-format', 'text', '--output-format', 'stream-json', '--verbose',
      '--no-session-persistence', '--permission-mode', 'dontAsk', '--permission-prompts', 'none', '--disallowedTools', 'Agent,Task']
    if (config.pure) args.push('--safe-mode', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}')
    if (config.permissionMode === 'deny') args.push('--tools', '')
    else args.push('--allowedTools', 'Read,Glob,Grep,Edit,Write,Bash')
    if (config.model !== undefined) args.push('--model', config.model)
    if (config.variant !== undefined) args.push('--effort', config.variant)
    return { args, stdin: prompt }
  },
  transcript: createClaudeCodeTranscript,
}
