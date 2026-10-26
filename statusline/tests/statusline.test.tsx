import type { On, SessionUsage, TurnStepInput, TurnUsage } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import type { Meter } from '../types'
import { fmtMs, fmtTokens, modelName, parseGit, prettyModel } from '../hooks/register'

const STEP: TurnStepInput = { turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 1 }

const BAND = {
  plugin: 'statusline',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const GIT_STATUS = [
  '# branch.oid 849cbe3b41bba0c08475e14fd3ca893202ab4a8a',
  '# branch.head main',
  '# branch.upstream origin/main',
  '# branch.ab +2 -1',
  '1 .M N... 100644 100644 100644 abc abc README.md',
  '? new-file.ts',
  '',
].join('\n')

const USAGE: SessionUsage = {
  startedAt: 0,
  context: { tokens: 62_000, window: 200_000, percent: 31 },
  rateLimits: [],
  cost: { usd: 1.2345 },
}

// performance.now() is the real clock, so the fake response really waits.
const spin = (ms: number) => {
  const until = performance.now() + ms
  while (performance.now() < until) {}
}

type Fake = { firstMs: number; bodyMs: number; usage: Partial<TurnUsage> }

function world(on: On, session: string, responses: Fake[]) {
  mock.clock(on)
  const store = new Map<string, unknown>()
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.delete', ($, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: session }))
  on('session.model', () => ({ value: 'opus' }))
  on('session.cwd', () => ({ value: '/home/u/workspace/claude-mods' }))
  on('session.usage', () => ({ value: USAGE }))
  on('process.run', () => ({
    value: { exitCode: 0, stdout: GIT_STATUS, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('ui.invalidate', () => ({ value: undefined }))
  let n = 0
  on('turn.step', async function* ($, e) {
    const { firstMs, bodyMs, usage: partial } = responses[n++] ?? { firstMs: 0, bodyMs: 0, usage: {} }
    spin(firstMs)
    yield { kind: 'text', index: 0, text: 'Hello' }
    spin(bodyMs)
    const usage: TurnUsage = {
      input_tokens: 0,
      output_tokens: 1,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      model: e.model,
      ...partial,
    }
    yield { kind: 'stop', stopReason: 'end_turn', usage }
    return { turnId: e.turnId, index: e.index, answer: 'Hello', toolUses: [], stopReason: 'end_turn', usage }
  })
  // The plugin writes its totals through to the store after every step.
  return { store, meter: () => store.get(`meter:${session}`) as Meter | undefined }
}

// Reads the stream to its end and answers its return value: the step's result.
async function drain<R>(stream: AsyncGenerator<unknown, R>): Promise<R> {
  let r = await stream.next()
  while (!r.done) r = await stream.next()
  return r.value
}

test('adds up tokens and times a main-loop step', async ($, on) => {
  const w = world(on, 'sess-a', [
    {
      firstMs: 100,
      bodyMs: 400,
      usage: { input_tokens: 1000, cache_read_input_tokens: 9000, cache_creation_input_tokens: 0, output_tokens: 200 },
    },
  ])
  const result = await drain($.turn.step(STEP))
  expect(result).toMatchObject({ answer: 'Hello', stopReason: 'end_turn' })

  const m = w.meter()
  expect(m?.sessionId).toBe('sess-a')
  expect(m?.tokens).toEqual({ input: 10_000, output: 200, cacheRead: 9000, cacheWrite: 0 })
  expect(m?.speed.ttftMs).toBeGreaterThanOrEqual(90)
  expect(m?.speed.ttftMs).toBeLessThan(400)
  // 200 tokens over ~400ms is ~500 tok/s
  expect(m?.speed.tps).toBeGreaterThan(300)
  expect(m?.speed.tps).toBeLessThanOrEqual(510)
  expect(m?.model).toBe('claude-opus-5-5')
  expect(m?.effort).toBe('high')
})

test('a burst of a few tokens keeps the previous rate', async ($, on) => {
  const w = world(on, 'sess-b', [
    { firstMs: 50, bodyMs: 300, usage: { output_tokens: 150 } },
    { firstMs: 50, bodyMs: 0, usage: { output_tokens: 12 } },
  ])
  await drain($.turn.step(STEP))
  const first = w.meter()
  await drain($.turn.step({ ...STEP, index: 1 }))
  const second = w.meter()

  expect(second?.speed.tps).toBe(first?.speed.tps ?? -1)
  expect(second?.speed.steps).toBe(2)
  expect(second?.speed.outputTokens).toBe(162)
})

test("a subagent's tokens count, its speed does not", async ($, on) => {
  const w = world(on, 'sess-c', [{ firstMs: 10, bodyMs: 300, usage: { input_tokens: 500, output_tokens: 100 } }])
  await drain($.turn.step({ ...STEP, agentId: 'agent-1' }))
  const m = w.meter()
  expect(m?.tokens.input).toBe(500)
  expect(m?.tokens.output).toBe(100)
  expect(m?.speed.steps).toBe(0)
  expect(m?.speed.tps).toBe(null)
})

test('a resumed session picks its totals back up', async ($, on) => {
  const w = world(on, 'sess-d', [{ firstMs: 0, bodyMs: 0, usage: { input_tokens: 10, output_tokens: 5 } }])
  w.store.set('meter:sess-d', {
    sessionId: 'sess-d',
    tokens: { input: 1000, output: 100, cacheRead: 0, cacheWrite: 0 },
    speed: { ttftMs: 800, tps: 90, steps: 3, outputTokens: 100, decodeMs: 1000, ttftTotalMs: 2400 },
    model: 'claude-opus-5-5',
    effort: null,
  })
  await drain($.turn.step(STEP))
  const m = w.meter()
  expect(m?.tokens.input).toBe(1010)
  expect(m?.tokens.output).toBe(105)
  expect(m?.speed.steps).toBe(4)
  expect(m?.speed.tps).toBe(90)
})

test('the band shows every figure', async ($, on) => {
  world(on, 'sess-e', [
    {
      firstMs: 50,
      bodyMs: 300,
      usage: { input_tokens: 1000, cache_read_input_tokens: 9000, output_tokens: 150 },
    },
  ])
  // The engine's own band, empty with no survey.
  on('ui.render', () => ({ type: 'engine', ref: 0 }))
  await $.session.start({ cwd: '/home/u/workspace/claude-mods', surface: 'terminal', isInteractive: true })
  await drain($.turn.step(STEP))

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    const text = async (pattern: RegExp) => (await ui.find({ type: 'Text', text: pattern }))?.text
    expect(await text(/Opus 5\.5/)).toContain('✦ Opus 5.5')
    expect(await text(/claude-mods/)).toContain('claude-mods')
    expect(await text(/⎇ main/)).toBe('claude-mods ⎇ main ●2 ⇡2 ⇣1')
    expect(await text(/31%/)).toContain('31%')
    expect(await text(/62k\/200k/)).toContain('62k/200k')
    expect(await text(/\$1\.23/)).toBe('$1.23')
    expect(await text(/cache/)).toBe('cache 90%')
    expect(await text(/TTFT/)).toMatch(/^TTFT \d+ms$/)
    expect(await text(/tok\/s/)).toMatch(/^\d+ tok\/s avg \d+$/)
    expect(await text(/ in /)).toBe('↑ 10k in  ↓ 150 out')
    await ui.unmount()
  }
})

test('the band yields to a survey', async ($, on) => {
  world(on, 'sess-f', [])
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>survey</Text>
  })
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, hasSurvey: true }, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /survey/ }))?.text).toBe('survey')
  expect(await ui.find({ type: 'Text', text: /Opus/ })).toBe(undefined)
  await ui.unmount()
})

test('the band keeps what the mods beneath draw, above its rows', async ($, on) => {
  world(on, 'sess-g', [])
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>lanes</Text>
  })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
    const lanes = texts.indexOf('lanes')
    expect(lanes).toBeGreaterThan(-1)
    expect(texts.findIndex(t => /Opus/.test(t))).toBeGreaterThan(lanes)
    await ui.unmount()
  }
})

test('formatting', () => {
  expect(parseGit(GIT_STATUS)).toEqual({ branch: 'main', ahead: 2, behind: 1, changed: 2 })
  expect(parseGit('# branch.oid 849cbe3b41bb\n# branch.head (detached)\n').branch).toBe('849cbe3')

  expect(prettyModel('claude-opus-5-5')).toBe('Opus 5.5')
  expect(prettyModel('claude-opus-4-1-20250805')).toBe('Opus 4.1')
  expect(prettyModel('claude-sonnet-4-20250514')).toBe('Sonnet 4')
  expect(prettyModel('claude-sonnet-4-5[1m]')).toBe('Sonnet 4.5')
  expect(prettyModel('us.anthropic.claude-haiku-4-5-20251001-v1:0')).toBe('Haiku 4.5')
  expect(prettyModel('claude-3-5-sonnet-20241022')).toBe('Sonnet 3.5')
  expect(prettyModel('opus')).toBe('Opus')
  expect(modelName('opus[1m]', 'claude-opus-5-5')).toBe('Opus 5.5')
  expect(modelName('sonnet', 'claude-opus-5-5')).toBe('Sonnet')
  expect(modelName('claude-fable-5-1', 'claude-opus-5-5')).toBe('Fable 5.1')

  expect(fmtTokens(999)).toBe('999')
  expect(fmtTokens(1234)).toBe('1.2k')
  expect(fmtTokens(35_210)).toBe('35k')
  expect(fmtTokens(1_234_567)).toBe('1.23M')
  expect(fmtTokens(12_345_678)).toBe('12.3M')
  expect(fmtMs(850)).toBe('850ms')
  expect(fmtMs(1140)).toBe('1.1s')
  expect(fmtMs(65_000)).toBe('1m5s')
})
