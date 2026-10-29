import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { keyOf } from '../hooks/prompt'
import { MAIN, cardId, excerpt, fromReview, parsePair, parsePicks, pick, schedule } from '../hooks/vocab'
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
  // Each command registered, and whether it runs mid-turn.
  const immediate: Record<string, boolean> = {}
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => {
    immediate[e.name] = e.immediate === true
    return { value: { command: e.name } }
  })
  on('prompt.submit', (_, e) => ({ text: e.text }))
  // The asks for the pane's keyboard; the surface gives it at the third, as one would
  // that refuses while the prompt still holds "/vocab".
  const focus = { asks: 0 }
  on('ui.open', (_, e) => {
    if (e.focus) focus.asks++
    return { value: { isPlaced: true } }
  })
  on('ui.panes', () => ({
    value: [{ id: 'vocab', title: '生词本', isShown: true, isPlaced: true, isFocused: focus.asks >= 3 }],
  }))
  on('model.complete', (_, e) => {
    const kind = e.system?.includes('worth learning') ? 'phrases' : e.system?.includes('coach') ? 'review' : 'translate'
    calls[kind]++
    const text = kind === 'phrases' ? phrases : kind === 'review' ? FIX : ZH_EN
    return { value: { isAnswered: true, text, usage: USAGE } }
  })
  return { clock, calls, immediate, focus }
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

const ZH2 = '先别急着提交，等测试跑完再说'
const ZH2_EN = 'Hold off on committing until the tests finish.'

test('a phrase is kept only where both texts hold it', () => {
  const reply = [
    "PHRASE: 顺便 => while you're at it",
    'PHRASE: 不在原文里 => add a timeout',
    'PHRASE: 超时 => graceful shutdown',
    'PHRASE: 函数 => function',
  ].join('\n')
  const picks = parsePicks(reply, [{ source: ZH, english: ZH_EN }])
  expect(picks[0]?.map(f => [f.cue, f.answer])).toEqual([['顺便', "while you're at it"]])
  expect(parsePicks('NONE', [{ source: ZH, english: ZH_EN }])).toEqual([[]])
  const hyphened = parsePicks('PHRASE: 过度设计 => over-engineered', [
    { source: '有点过度设计了', english: 'It is a bit over-engineered.' },
  ])
  expect(hyphened[0]?.[0]?.answer).toBe('over-engineered')
})

// A prompt whose phrase is in its last sentence, past the first 200 characters.
const PLAN = '你要先调研、然后制定完善的开发计划，然后跟我沟通确认之后再动手'
const PLAN_ZH = `我有剧本资源，有 codex 可以生成图片。${'之前的做法我都不喜欢，太简陋，处处穿帮。'.repeat(8)}\n\n${PLAN}`
const PLAN_EN = `I have a script for the story, and Codex can generate images.${" I didn't like the earlier approaches.".repeat(8)}\n\nFirst, research the options. Then draw up a solid development plan. Then check it with me before building anything.`

test('a phrase card holds the sentences its two sides stand in, not the prompt\'s start', () => {
  const [found] = parsePicks('PHRASE: 制定完善的开发计划 => draw up a solid development plan', [
    { source: PLAN_ZH, english: PLAN_EN },
  ])
  expect(found).toEqual([
    {
      kind: 'phrase',
      cue: '制定完善的开发计划',
      answer: 'draw up a solid development plan',
      context: PLAN,
      example: 'Then draw up a solid development plan.',
    },
  ])

  // English the person typed among their Chinese is no cue; the words around it are.
  const mixed = { source: '要让人一眼就能 get 到重点', english: 'People should get the point at a glance.' }
  const reply = 'PHRASE: get => get the point at a glance\nPHRASE: 一眼就能 get 到重点 => get the point at a glance'
  expect(parsePicks(reply, [mixed])[0]?.map(f => f.cue)).toEqual(['一眼就能 get 到重点'])
})

test('an excerpt is the sentence that holds the words, cut around them when long', () => {
  expect(excerpt('First line.\nThen  Draw up\na plan. Next one.', 'draw up a plan')).toBe('Then Draw up a plan.')
  expect(excerpt('一。二。三。四。', '三。')).toBe('三。')
  expect(excerpt('一。二。三。四。', '三。', 1)).toBe('二。三。四。')
  // Not there: the start of the text, as before.
  expect(excerpt('Nothing here. At all.', 'draw up')).toBe('Nothing here. At all.')

  const long = `${'很长的背景说明，'.repeat(40)}然后制定完善的开发计划，${'再补充一些要求，'.repeat(40)}`
  const got = excerpt(long, '制定完善的开发计划')
  expect(got).toContain('制定完善的开发计划')
  expect(got.startsWith('…') && got.endsWith('…')).toBe(true)
  expect(got.length).toBeLessThanOrEqual(202)
})

test('a pattern is a sentence of both texts whose frame is its own words', () => {
  const items = [
    { source: ZH, english: ZH_EN },
    { source: ZH2, english: ZH2_EN },
  ]
  const reply = [
    "[1] PHRASE: 顺便 => while you're at it",
    '[2] PATTERN: 先别急着提交，等测试跑完再说 => Hold off on committing until the tests finish. => Hold off on ___ until ___',
    '[2] PATTERN: 先别急着提交 => Hold off on committing => Hold off on ___',
  ].join('\n')
  const [first, second] = parsePicks(reply, items)
  expect(first?.map(f => f.kind)).toEqual(['phrase'])
  expect(second).toEqual([
    {
      kind: 'pattern',
      cue: ZH2,
      answer: ZH2_EN,
      pattern: 'Hold off on ___ until ___',
    },
  ])

  const bad = [
    // A frame of words the sentence does not have.
    '[1] PATTERN: 先别急着提交，等测试跑完再说 => Hold off on committing until the tests finish. => Wait to ___ until ___',
    // No blank to fill.
    '[1] PATTERN: 先别急着提交，等测试跑完再说 => Hold off on committing until the tests finish. => Hold off on committing',
    // A sentence of neither text.
    '[1] PATTERN: 等一下 => Hold off on committing until the tests finish. => Hold off on ___ until ___',
  ].join('\n')
  expect(parsePicks(bad, [{ source: ZH2, english: ZH2_EN }])).toEqual([[]])
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
  await ui.press({ key: MAIN })
  expect(await ui.find({ type: 'Text', text: /add a timeout/ })).toBeDefined()
  await ui.press({ key: MAIN })
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
  await ui.press({ key: MAIN })
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
  await ui.press({ key: MAIN })
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

test('/vocab and /prompt-en run at once, even mid-turn', async ($, on) => {
  const w = world(on)
  await start($)
  expect(w.immediate).toEqual({ 'prompt-en': true, vocab: true })
})

test('/vocab asks for the keyboard again until the pane has it', async ($, on) => {
  const w = world(on, { 'v:c1': card() })
  await start($)
  await vocab($)
  expect(w.focus.asks).toBe(1)
  await w.clock.advance(5_000)
  expect(w.focus.asks).toBe(3)
})

test('the main control keeps its key as the card turns, so the keyboard stays on it', async ($, on) => {
  world(on, { 'v:c1': card(), 'v:c2': card({ id: 'c2', cue: 'more faster', answer: 'faster' }) })
  await start($)
  await vocab($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const labels: string[] = []
  for (let i = 0; i < 5; i++) {
    labels.push((await ui.find({ type: 'Button', key: MAIN }))?.text ?? '')
    await ui.press({ key: MAIN })
  }
  labels.push((await ui.find({ type: 'Button', key: MAIN }))?.text ?? '')
  expect(labels).toEqual(['显示答案', '记得', '显示答案', '记得', '再练几张', '显示答案'])
  await ui.unmount()
})

// --- importing what came before ---------------------------------------------------------

const HISTORY = [ZH, ZH2, '跑一下', EN, 'not json']
  .map(text => (text === 'not json' ? text : JSON.stringify({ display: text, timestamp: 1 })))
  .join('\n')

// What prompt-en kept from before the book; `isZhKept` false leaves ZH to be typed now.
function past(on: On, isZhKept = true) {
  const kept: Record<string, unknown> = {
    ...(isZhKept ? { [`t:${keyOf(ZH)}`]: { status: 'done', kind: 'translate', text: ZH_EN } } : {}),
    [`t:${keyOf(ZH2)}`]: { status: 'done', text: ZH2_EN },
    [`t:${keyOf(EN)}`]: {
      status: 'done',
      kind: 'review',
      verdict: 'fix',
      base: EN,
      text: 'Make this function async and add a timeout',
      note: 'article: "add timeout" → "add a timeout"',
    },
  }
  const w = world(
    on,
    kept,
    "[1] PHRASE: 顺便 => while you're at it\n[2] PATTERN: 先别急着提交，等测试跑完再说 => Hold off on committing until the tests finish. => Hold off on ___ until ___",
  )
  mock.env(on, { HOME: '/home/u' })
  on('fs.read', (_, e) => {
    if (e.path !== '/home/u/.claude/history.jsonl') throw new Error('ENOENT')
    return { value: HISTORY }
  })
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  return { ...w, toasts }
}

test('/vocab import files the corrections and translations from before the book', async ($, on) => {
  const w = past(on)
  await start($)
  const ran = await vocab($, 'import')
  expect(ran.text).toContain('开始导入')
  await w.clock.settle()

  // Both translations went in one call; the review needed none.
  expect(w.calls).toEqual({ translate: 0, review: 0, phrases: 1 })
  expect(w.toasts.at(-1)).toContain('看了 3 条以前的 prompt，新收 3 张（纠错 1 · 短语 1 · 句型 1）')
  const listed = (await vocab($, 'list')).text
  expect(listed).toContain('add timeout → add a timeout')
  expect(listed).toContain("顺便 → while you're at it")
  expect(listed).toContain('Hold off on ___ until ___')

  // Again: nothing new, and no call.
  await vocab($, 'import')
  await w.clock.settle()
  expect(w.calls.phrases).toBe(1)
  expect(w.toasts.at(-1)).toBe('生词本：没有新的可以导入了。')
})

test('a pattern card shows the sentence, then its English and the frame', async ($, on) => {
  const id = cardId('pattern', ZH2, ZH2_EN, 'Hold off on ___ until ___')
  world(on, {
    [`v:${id}`]: card({ id, kind: 'pattern', cue: ZH2, answer: ZH2_EN, pattern: 'Hold off on ___ until ___' }),
  })
  await start($)
  await vocab($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: new RegExp(`^${ZH2}$`) })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Hold off on ___/ })).toBeUndefined()
  await ui.press({ key: MAIN })
  expect(await ui.find({ type: 'Text', text: /^Hold off on ___ until ___$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^句型/ })).toBeDefined()
  await ui.unmount()
})

test('a phrase card marks its words in the sentence, and its English in the example', async ($, on) => {
  const cue = '制定完善的开发计划'
  const answer = 'draw up a solid development plan'
  const id = cardId('phrase', cue, answer)
  world(on, {
    [`v:${id}`]: card({ id, kind: 'phrase', cue, answer, context: PLAN, example: 'Then draw up a solid development plan.' }),
  })
  await start($)
  await vocab($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const cues = await ui.findAll({ type: 'Text', text: new RegExp(`^${cue}$`) })
  expect(cues.filter(t => t.props.bold === true)).toHaveLength(1)
  expect(await ui.find({ type: 'Text', text: /^然后跟我沟通/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^，然后跟我沟通确认之后再动手$/ })).toBeDefined()
  await ui.press({ key: MAIN })
  const answers = await ui.findAll({ type: 'Text', text: new RegExp(`^${answer}$`) })
  expect(answers.filter(t => t.props.color === 'success' && t.props.bold === true)).toHaveLength(2)
  expect(await ui.find({ type: 'Text', text: /^Then $/ })).toBeDefined()
  await ui.unmount()
})

test('a prompt filed as it was typed is not filed again by an import', async ($, on) => {
  const w = past(on, false)
  await start($)
  await submit($, ZH)
  await w.clock.settle()
  expect(w.calls).toEqual({ translate: 1, review: 0, phrases: 1 })
  await vocab($, 'import')
  await w.clock.settle()
  // ZH was filed live; ZH2 and the review are new.
  expect(w.toasts.at(-1)).toContain('看了 2 条以前的 prompt')
})
