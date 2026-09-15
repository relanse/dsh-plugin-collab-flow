import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { createOpenCodeTranscript } from '../lib/types/opencode.js'

const fixture = name => readFileSync(new URL('../../../tests/fixtures/opencode/' + name + '.jsonl', import.meta.url), 'utf8')
const events = name => fixture(name).trim().split('\n').map(line => JSON.parse(line))
function decode(text, size = 97, limits) {
  const transcript = createOpenCodeTranscript(limits)
  const bytes = Buffer.from(text, 'utf8')
  for (let offset = 0; offset < bytes.length; offset += size) transcript.push(bytes.subarray(offset, offset + size))
  transcript.end()
  return transcript
}
const jsonl = values => values.map(value => JSON.stringify(value)).join('\n')

test('real stdin fixture decodes across byte boundaries and reports complete usage', () => {
  const result = decode(fixture('stdin'), 1)
  assert.deepEqual(result.output(), [{ type: 'text', text: 'COLLAB_M0_OK' }])
  assert.equal(result.terminal(), 'completed')
  assert.deepEqual(result.usage(), { input: 3660, output: 7, total: 3667, reasoning: 0, cacheRead: 0, cacheWrite: 0, reportedSteps: 1, observedSteps: 1, complete: true })
})

test('UTF-8 characters survive split chunks and a final line without newline', () => {
  const input = events('reply')
  input[1].part.text = '中文桃子🍑'
  const result = decode(jsonl(input), 1)
  assert.equal(result.output()[0].text, '中文桃子🍑')
  assert.equal(result.terminal(), 'completed')
})

test('multiple tool steps count all usage and preserve only the final assistant message', () => {
  const result = decode(fixture('denied-tool'))
  assert.equal(result.output()[0].text, 'ACCESS_DENIED')
  assert.equal(result.usage().total, 28438)
  assert.equal(result.usage().reportedSteps, 6)
  assert.equal(result.usage().complete, true)
})

test('replayed completions do not count twice or replace the latest terminal step', () => {
  const input = events('denied-tool')
  input.push(structuredClone(input.find(event => event.type === 'step_finish')))
  const result = decode(jsonl(input))
  assert.equal(result.usage().total, 28438)
  assert.equal(result.terminal(), 'completed')
})

test('an older completion cannot replace a newer snapshot for the same message', () => {
  const input = events('reply')
  const stale = structuredClone(input[2])
  stale.timestamp -= 1
  stale.part.tokens.total = 999999
  input.push(stale)
  assert.equal(decode(jsonl(input)).usage().total, 3669)
})

test('text snapshots replace a part rather than duplicating its content', () => {
  const input = events('reply')
  const update = structuredClone(input[1])
  update.part.text = 'updated'
  input.push(update)
  assert.deepEqual(decode(jsonl(input)).output(), [{ type: 'text', text: 'updated' }])
})

test('partial output without terminal usage remains incomplete and unknown', () => {
  const result = decode(fixture('cancelled'))
  assert.equal(result.terminal(), 'incomplete')
  assert.equal(result.usage(), undefined)
})

test('tool-calls completion is not terminal success', () => {
  const input = events('reply')
  input[2].part.reason = 'tool-calls'
  const result = decode(jsonl(input))
  assert.equal(result.terminal(), 'incomplete')
  assert.equal(result.usage().complete, false)
})

test('malformed usage never turns successful text into fake zero counts', () => {
  for (const invalid of [-1, '123', null, Number.MAX_SAFE_INTEGER + 1]) {
    const input = events('reply')
    input[2].part.tokens.input = invalid
    const result = decode(jsonl(input))
    assert.equal(result.terminal(), 'completed')
    assert.equal(result.usage(), undefined)
  }
})

test('missing usage for one step explicitly marks an aggregate as partial', () => {
  const input = events('denied-tool')
  delete input.find(event => event.type === 'step_finish').part.tokens
  const usage = decode(jsonl(input)).usage()
  assert.equal(usage.reportedSteps, 5)
  assert.equal(usage.observedSteps, 6)
  assert.equal(usage.complete, false)
})

test('unsafe aggregate arithmetic is discarded', () => {
  const input = events('denied-tool')
  for (const event of input.filter(event => event.type === 'step_finish')) event.part.tokens.total = Number.MAX_SAFE_INTEGER
  assert.equal(decode(jsonl(input)).usage(), undefined)
})

test('unknown event extensions are ignored while explicit errors remain failures', () => {
  assert.equal(decode('{"type":"future_event","opaque":true}\n' + fixture('reply')).terminal(), 'completed')
  assert.equal(decode(fixture('model-error')).terminal(), 'failed')
})

test('cross-session output is rejected before it can contaminate the transcript', () => {
  const input = events('reply')
  input[1].sessionID = 'other-session'
  assert.throws(() => decode(jsonl(input)), error => error.code === 'session-mismatch')
})

test('malformed JSON, invalid UTF-8 and oversized output fail with bounded diagnostics', () => {
  assert.throws(() => decode('{"type":'), error => error.code === 'invalid-json')
  const bytes = createOpenCodeTranscript()
  assert.throws(() => bytes.push(Uint8Array.of(0xff)), error => error.code === 'invalid-utf8')
  assert.throws(() => decode('x'.repeat(65), 10, { maxLineBytes: 64, maxOutputBytes: 100 }), error => error.code === 'line-limit')
  assert.throws(() => decode('\n'.repeat(101), 10, { maxLineBytes: 64, maxOutputBytes: 100 }), error => error.code === 'output-limit')
})

test('a reasoning payload cannot masquerade as text, and malformed timestamps reject', () => {
  for (const edit of [event => { event.part.type = 'reasoning' }, event => { event.timestamp = -1 }]) {
    const input = events('reply')
    edit(input[1])
    assert.throws(() => decode(jsonl(input)), error => error.code === 'invalid-event')
  }
})
