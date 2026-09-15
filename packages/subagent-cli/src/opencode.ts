import { TextDecoder } from 'node:util'
import { CliFailure } from './failure.ts'
import type { CliUsage } from './types.ts'

interface ProtocolLimits { maxOutputBytes: number; maxLineBytes: number }
interface Message { parts: Map<string, string>; reason?: string; timestamp?: number; usage?: StepUsage }
interface StepUsage { input: number; output: number; total: number; reasoning?: number; cacheRead?: number; cacheWrite?: number }

const DEFAULT_LIMITS: ProtocolLimits = { maxOutputBytes: 4 * 1024 * 1024, maxLineBytes: 1024 * 1024 }
const USAGE_FIELDS = ['input', 'output', 'total', 'reasoning', 'cacheRead', 'cacheWrite'] as const

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new CliFailure('invalid-event')
  return value as Record<string, unknown>
}
function identity(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) throw new CliFailure('invalid-event')
  return value
}
function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}
function stepUsage(value: unknown): StepUsage | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const tokens = value as Record<string, unknown>
  const input = count(tokens.input), output = count(tokens.output), total = count(tokens.total)
  if (input === undefined || output === undefined || total === undefined) return undefined
  const optional: Partial<StepUsage> = {}
  const reasoning = count(tokens.reasoning)
  if (reasoning !== undefined) optional.reasoning = reasoning
  if (tokens.cache !== null && typeof tokens.cache === 'object' && !Array.isArray(tokens.cache)) {
    const cache = tokens.cache as Record<string, unknown>
    const read = count(cache.read), write = count(cache.write)
    if (read !== undefined) optional.cacheRead = read
    if (write !== undefined) optional.cacheWrite = write
  }
  return { input, output, total, ...optional }
}

export interface OpenCodeTranscript {
  push(chunk: Uint8Array): void
  end(): void
  externalSessionId(): string | undefined
  output(): Array<{ type: 'text'; text: string }>
  terminal(): 'completed' | 'failed' | 'incomplete'
  usage(): CliUsage | undefined
}

export function createOpenCodeTranscript(limits: ProtocolLimits = DEFAULT_LIMITS): OpenCodeTranscript {
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let pending = '', bytes = 0, ended = false, failed = false
  let sessionId: string | undefined, latestMessage: string | undefined
  const messages = new Map<string, Message>()

  function push(chunk: Uint8Array): void {
    if (ended) throw new CliFailure('invalid-event')
    bytes += chunk.byteLength
    if (bytes > limits.maxOutputBytes) throw new CliFailure('output-limit')
    let text: string
    try { text = decoder.decode(chunk, { stream: true }) } catch { throw new CliFailure('invalid-utf8') }
    acceptText(text)
  }

  function end(): void {
    if (ended) return
    let tail: string
    try { tail = decoder.decode() } catch { throw new CliFailure('invalid-utf8') }
    acceptText(tail)
    if (pending.trim() !== '') line(pending)
    pending = ''
    ended = true
  }

  function output(): Array<{ type: 'text'; text: string }> {
    for (const message of [...messages.values()].reverse()) {
      const parts = [...message.parts.values()].filter(text => text.trim() !== '')
      if (parts.length > 0) return parts.map(text => ({ type: 'text', text }))
    }
    return []
  }

  function terminal(): 'completed' | 'failed' | 'incomplete' {
    if (failed) return 'failed'
    if (!ended || latestMessage === undefined) return 'incomplete'
    return messages.get(latestMessage)?.reason === 'stop' ? 'completed' : 'incomplete'
  }

  function usage(): CliUsage | undefined {
    const reported = [...messages.values()].flatMap(message => message.usage === undefined ? [] : [message.usage])
    if (reported.length === 0) return undefined
    const sums: Partial<StepUsage> = {}
    for (const field of USAGE_FIELDS) {
      const values = reported.map(item => item[field])
      if (values.some(value => value === undefined)) continue
      const sum = values.reduce<number>((total, value) => total + (value ?? 0), 0)
      if (!Number.isSafeInteger(sum)) return undefined
      sums[field] = sum
    }
    const { input, output, total } = sums
    if (input === undefined || output === undefined || total === undefined) return undefined
    return {
      ...sums, input, output, total,
      reportedSteps: reported.length,
      observedSteps: messages.size,
      complete: terminal() === 'completed' && reported.length === messages.size,
    }
  }

  function acceptText(text: string): void {
    const lines = (pending + text).split('\n')
    pending = lines.pop() ?? ''
    for (const textLine of lines) line(textLine)
    if (Buffer.byteLength(pending, 'utf8') > limits.maxLineBytes) throw new CliFailure('line-limit')
  }

  function line(text: string): void {
    if (Buffer.byteLength(text, 'utf8') > limits.maxLineBytes) throw new CliFailure('line-limit')
    if (text.trim() === '') return
    let value: unknown
    try { value = JSON.parse(text) } catch { throw new CliFailure('invalid-json') }
    const event = record(value)
    if (typeof event.type !== 'string') throw new CliFailure('invalid-event')
    if (event.type === 'error') { failed = true; return }
    if (!['step_start', 'step_finish', 'text', 'tool_use'].includes(event.type)) return
    const session = identity(event.sessionID)
    if (sessionId !== undefined && sessionId !== session) throw new CliFailure('session-mismatch')
    sessionId = session
    const part = record(event.part)
    const expectedType = event.type === 'step_start' ? 'step-start' : event.type === 'step_finish' ? 'step-finish' : event.type === 'tool_use' ? 'tool' : 'text'
    if (part.type !== expectedType || count(event.timestamp) === undefined) throw new CliFailure('invalid-event')
    if (identity(part.sessionID) !== session) throw new CliFailure('session-mismatch')
    const messageId = identity(part.messageID)
    let message = messages.get(messageId)
    if (message === undefined) {
      message = { parts: new Map() }
      messages.set(messageId, message)
      latestMessage = messageId
    }
    if (event.type === 'text') {
      if (typeof part.text !== 'string') throw new CliFailure('invalid-event')
      message.parts.set(identity(part.id), part.text)
    } else if (event.type === 'step_finish') {
      if (typeof part.reason !== 'string') throw new CliFailure('invalid-event')
      const timestamp = count(event.timestamp)
      if (timestamp !== undefined && message.timestamp !== undefined && timestamp < message.timestamp) return
      if (timestamp !== undefined) message.timestamp = timestamp
      message.reason = part.reason
      const usage = stepUsage(part.tokens)
      if (usage !== undefined) message.usage = usage
      else delete message.usage
    }
  }

  return { push, end, output, terminal, usage, externalSessionId: () => sessionId }
}
