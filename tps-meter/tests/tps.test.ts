import type { On, TurnStepInput, TurnUsage } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const STEP: TurnStepInput = { turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 }
const path = (session: string) => `/home/u/.claude/tps/${session}.json`

// performance.now() is the real clock, so the fake response really waits.
const spin = (ms: number) => {
  const until = performance.now() + ms
  while (performance.now() < until) {}
}

type Fake = { firstMs: number; bodyMs: number; outputTokens: number }

function world(on: On, session: string, responses: Fake[]) {
  const files = new Map<string, string>()
  mock.env(on, { HOME: '/home/u' })
  on('session.id', () => ({ value: session }))
  on('fs.read', ($, e) => {
    const text = files.get(e.path)
    if (text === undefined) throw new Error('ENOENT')
    return { value: text }
  })
  on('fs.write', ($, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  let n = 0
  on('turn.step', async function* ($, e) {
    const { firstMs, bodyMs, outputTokens } = responses[n++] ?? { firstMs: 0, bodyMs: 0, outputTokens: 1 }
    spin(firstMs)
    yield { kind: 'text', index: 0, text: 'Hello' }
    spin(bodyMs)
    const usage: TurnUsage = {
      input_tokens: 1,
      output_tokens: outputTokens,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      model: e.model,
    }
    yield { kind: 'stop', stopReason: 'end_turn', usage }
    return { turnId: e.turnId, index: e.index, answer: 'Hello', toolUses: [], stopReason: 'end_turn', usage }
  })
  return files
}

// Reads the stream to its end and answers its return value: the step's result.
async function drain<R>(stream: AsyncGenerator<unknown, R>): Promise<R> {
  let r = await stream.next()
  while (!r.done) r = await stream.next()
  return r.value
}

test('writes TTFT and tokens/s of a main-loop step', async ($, on) => {
  const files = world(on, 'sess-a', [{ firstMs: 100, bodyMs: 400, outputTokens: 200 }])
  const result = await drain($.turn.step(STEP))
  expect(result).toMatchObject({ answer: 'Hello', stopReason: 'end_turn' })

  const snap = JSON.parse(files.get(path('sess-a')) ?? 'null')
  expect(snap.output_tokens).toBe(200)
  expect(snap.ttft_ms).toBeGreaterThanOrEqual(90)
  expect(snap.ttft_ms).toBeLessThan(400)
  // 200 tokens over ~400ms is ~500 tok/s
  expect(snap.tps).toBeGreaterThan(300)
  expect(snap.tps).toBeLessThanOrEqual(510)
  expect(snap.last_tps).toBe(snap.tps)
  expect(snap.steps).toBe(1)
})

test('a burst of a few tokens keeps the previous rate', async ($, on) => {
  const files = world(on, 'sess-b', [
    { firstMs: 50, bodyMs: 300, outputTokens: 150 },
    { firstMs: 50, bodyMs: 0, outputTokens: 12 },
  ])
  await drain($.turn.step(STEP))
  const first = JSON.parse(files.get(path('sess-b')) ?? 'null')
  await drain($.turn.step({ ...STEP, index: 1 }))
  const second = JSON.parse(files.get(path('sess-b')) ?? 'null')

  expect(second.tps).toBe(null)
  expect(second.last_tps).toBe(first.tps)
  expect(second.output_tokens).toBe(12)
  expect(second.steps).toBe(2)
  expect(second.session_output_tokens).toBe(162)
})

test('subagent steps are not recorded', async ($, on) => {
  const files = world(on, 'sess-c', [{ firstMs: 10, bodyMs: 300, outputTokens: 100 }])
  await drain($.turn.step({ ...STEP, agentId: 'agent-1' }))
  expect(files.size).toBe(0)
})
