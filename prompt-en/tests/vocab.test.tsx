import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { cardId, fromReview, parsePair, parsePhrases, pick, schedule } from '../hooks/vocab'
import type { Translation, VocabCard } from '../types'

const USAGE = { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const NOW = 1_000_000_000
const DAY = 86_400_000

const ZH = '帮我把这个函数改成异步的，顺便加上超时'
const ZH_EN = "Make this function async, and add a timeout while you're at it."
const EN = 'Make this function async and add timeout'
const FIX = 'VERDICT: fix\nTEXT: Make this function async and add a timeout\nNOTE: article: "add timeout" → "add a timeout"'

// The engine beneath the plugin: a store, a clock, and a model that translates,
// reviews and picks phrases, each by what it is asked.
function world(on: On, entries?: Record<string, unknown>, phrases = "PHRASE: 顺便 => while you're at it") {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on, entries)
  const calls = { translate: 0, review: 0, phrases: 0 }
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('model.complete', (_, e) => {
    const kind = e.system?.includes('worth learning') ? 'phrases' : e.system?.includes('coach') ? 'review' : 'translate'
    calls[kind]++
    const text = kind === 'phrases' ? phrases : kind === 'review' ? FIX : ZH_EN
    return { value: { isAnswered: true, text, usage: USAGE } }
  })
  return { clock, calls }
}

async function start($: Engine) {
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
}

async function submit($: Engine, text: string) {
  await $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false })
}

const vocab = ($: Engine, args = '') =>
  $.command.run({
    command: 'vocab',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 },
  })

const PANE = {
  plugin: 'prompt-en',
  component: 'Pane',
  requestId: 'vocab',
  props: {
    title: '生词本',
    isFocused: true,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const card = (over: Partial<VocabCard> = {}): VocabCard => ({
  id: 'c1',
  kind: 'fix',
  cue: 'add timeout',
  answer: 'add a timeout',
  addedAt: NOW,
  seen: 1,
  box: 0,
  due: NOW,
  lapses: 0,
  ...over,
})

// --- reading what the English taught -----------------------------------------------

test('a review note gives its change, and the kind of change as why', () => {
  expect(parsePair('article: "add timeout" → "add a timeout"')).toEqual({
    cue: 'add timeout',
    answer: 'add a timeout',
    why: 'article',
  })
  expect(parsePair('"more faster" -> "faster"')).toEqual({ cue: 'more faster', answer: 'faster' })
  expect(parsePair('“make it works” → “make it work” (verb form)')).toEqual({
    cue: 'make it works',
    answer: 'make it work',
    why: 'verb form',
  })
  expect(parsePair('changed the tone')).toBeNull()
  expect(parsePair('"Fix it" → "fix it"')).toBeNull()
})

test('a review that reads well gives no card; a long one, one per fix', () => {
  const ok: Translation = { status: 'done', kind: 'review', verdict: 'ok', text: '', base: 'Looks good to me' }
  expect(fromReview(ok)).toEqual([])
  const long: Translation = {
    status: 'done',
    kind: 'review',
    verdict: 'fix',
    text: '',
    base: 'long prompt',
    fixes: ['"informations" → "information"', '"discuss about" → "discuss"', 'not a pair'],
  }
  expect(fromReview(long).map(f => f.answer)).toEqual(['information', 'discuss'])
})

test('a phrase is kept only where both texts hold it', () => {
  const reply = [
    "PHRASE: 顺便 => while you're at it",
    'PHRASE: 不在原文里 => add a timeout',
    'PHRASE: 超时 => graceful shutdown',
    'PHRASE: 函数 => function',
  ].join('\n')
  expect(parsePhrases(reply, ZH, ZH_EN).map(f => [f.cue, f.answer])).toEqual([['顺便', "while you're at it"]])
  expect(parsePhrases('NONE', ZH, ZH_EN)).toEqual([])
})

test('a card moves up a box when known, starts over when forgotten', () => {
  const known = schedule(card(), 'good', NOW)
  expect(known.box).toBe(1)
  expect(known.due).toBe(NOW + DAY)
  const better = schedule(known, 'good', NOW)
  expect([better.box, better.due]).toEqual([2, NOW + 3 * DAY])
  const lost = schedule(better, 'again', NOW)
  expect([lost.box, lost.lapses]).toEqual([0, 1])
  expect(lost.due - NOW).toBeLessThan(DAY)
  expect(schedule(better, 'hard', NOW).box).toBe(2)
  expect(pick([card({ id: 'a', due: NOW + DAY }), card({ id: 'b', due: NOW - 1 })], NOW).map(c => c.id)).toEqual(['b'])
})

// --- in a session -------------------------------------------------------------------------

test('a corrected English prompt goes into the book, and /vocab reviews it', async ($, on) => {
  const w = world(on)
  await start($)
  await submit($, EN)
  await w.clock.settle()
  expect(w.calls.review).toBe(1)
  expect(w.calls.phrases).toBe(0)

  const listed = await vocab($, 'list')
  expect(listed.text).toContain('add timeout → add a timeout（article）')

  const opened = await vocab($)
  expect(opened.text).toContain('1 张待复习')
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /^add timeout$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /add a timeout/ })).toBeUndefined()
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'reveal' })
  expect(await ui.find({ type: 'Text', text: /add a timeout/ })).toBeDefined()
  await ui.press({ key: 'good' })
  expect(await ui.find({ type: 'Text', text: /记得 1/ })).toBeDefined()
  await ui.unmount()

  // Known once: not due again until tomorrow.
  expect((await vocab($)).text).toContain('今天没有到期的')
  await w.clock.advance(DAY + 1)
  expect((await vocab($)).text).toContain('1 张待复习')
})

test('a Chinese prompt gives the phrase its English uses', async ($, on) => {
  const w = world(on)
  await start($)
  await submit($, ZH)
  await w.clock.settle()
  expect(w.calls).toEqual({ translate: 1, review: 0, phrases: 1 })
  expect((await vocab($, 'list')).text).toContain("顺便 → while you're at it")
})

test('a forgotten card comes round again in the same sitting', async ($, on) => {
  world(on, { 'v:c1': card() })
  await start($)
  await vocab($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'reveal' })
  await ui.press({ key: 'again' })
  expect(await ui.find({ type: 'Text', text: /2 \/ 2/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^add timeout$/ })).toBeDefined()
  await ui.unmount()
})

test('the same mistake again sends a learnt card back to the start', async ($, on) => {
  const id = cardId('fix', 'add timeout', 'add a timeout')
  const w = world(on, { [`v:${id}`]: card({ id, box: 3, due: NOW + 7 * DAY, seen: 1 }) })
  await start($)
  expect((await vocab($)).text).toContain('今天没有到期的')
  await submit($, EN)
  await w.clock.settle()
  const listed = (await vocab($, 'list')).text
  expect(listed).toContain('×2')
  expect(listed).toContain('1 条到期')
})

test('a card can be dropped from the book', async ($, on) => {
  world(on, { 'v:c1': card() })
  await start($)
  await vocab($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'reveal' })
  await ui.press({ key: 'drop' })
  await ui.unmount()
  expect((await vocab($, 'list')).text).toContain('生词本还是空的')
})

test('collectVocab off keeps the book closed and costs no extra call', { options: { collectVocab: false } }, async ($, on) => {
  const w = world(on)
  await start($)
  await submit($, ZH)
  await submit($, EN)
  await w.clock.settle()
  expect(w.calls.phrases).toBe(0)
  expect((await vocab($, 'list')).text).toContain('生词本还是空的')
})

test('due cards are mentioned once at the start, not at every session', async ($, on) => {
  world(on, { 'v:c1': card() })
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  await start($)
  await start($)
  expect(toasts).toEqual(['生词本有 1 条该复习了 · /vocab'])
})
