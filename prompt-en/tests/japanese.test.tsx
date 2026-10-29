import type { On, RenderPropsOf } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { isJapanese } from '../hooks/lang'
import { keyOf } from '../hooks/prompt'
import { buildPrompt, buildReview, markChanges, modeOf, parseReview, prepare } from '../hooks/register'
import { MAIN, cardId, fromReview, parsePair, parsePicks } from '../hooks/vocab'
import type { Translation, VocabCard } from '../types'

// Learning Japanese: the `language` option set to japanese.

const USAGE = { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const JA = { options: { language: 'japanese' } }
const NOW = 1_000_000_000

const ZH = '以防万一，先把数据库备份一下'
const ZH_JA = '念のため、先にデータベースをバックアップしておいて。'
const WRONG = 'ファイルを読み込みに失敗しました'
const FIXED = [
  'VERDICT: fix',
  'TEXT: ファイルの読み込みに失敗しました',
  'NOTE: 助词: "ファイルを読み込みに失敗" → "ファイルの読み込みに失敗"',
].join('\n')

// The engine beneath the plugin: a store, a clock, a model that translates, reviews
// and picks phrases by what it is asked, and a UserMessage row the plugin draws under.
function world(on: On, entries?: Record<string, unknown>, picks = 'PHRASE: 以防万一 => 念のため => ねんのため') {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on, entries)
  const asked: Record<'translate' | 'review' | 'picks', string[]> = { translate: [], review: [], picks: [] }
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('model.complete', (_, e) => {
    const kind = e.system?.includes('worth learning') ? 'picks' : e.system?.includes('coach') ? 'review' : 'translate'
    asked[kind].push(`${e.system ?? ''}\n---\n${e.prompt}`)
    const text = kind === 'picks' ? picks : kind === 'review' ? FIXED : ZH_JA
    return { value: { isAnswered: true, text, usage: USAGE } }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine row</Text>
  })
  return { clock, asked }
}

const row = (text: string): RenderPropsOf['UserMessage'] => ({ text, origin: { kind: 'composer' }, isExpanded: false })

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

// --- what a prompt gets ------------------------------------------------------------

test('Japanese is told from Chinese by its kana', () => {
  expect(isJapanese(WRONG)).toBe(true)
  expect(isJapanese('この関数を非同期にして')).toBe(true)
  expect(isJapanese(ZH)).toBe(false)
  // Chinese with a stray の is still Chinese.
  expect(isJapanese('这是我の代码，帮我看看为什么跑不起来')).toBe(false)
})

test('learning Japanese: Japanese is reviewed, Chinese and English are translated', () => {
  const ja = (s: string) => modeOf(s, prepare(s), 'ja')
  expect(ja(WRONG)).toBe('review')
  expect(ja(ZH)).toBe('translate')
  expect(ja('Make this function async')).toBe('translate')
  expect(ja('fix 这个 bug')).toBe('translate')
  // Too short to bother: a few kana, two English words.
  expect(ja('はい')).toBe(null)
  expect(ja('続けて')).toBe(null)
  expect(ja('commit it')).toBe(null)
  // English is unchanged: Japanese is a foreign language there.
  expect(modeOf(WRONG)).toBe('translate')
})

test('the Japanese prompts ask for Japanese', () => {
  const t = buildPrompt(prepare(ZH), 'ja')
  expect(t.prompt).toContain('faithfully')
  expect(buildPrompt(prepare('我'.repeat(800)), 'ja').prompt).toContain('about 200 characters')
  expect(buildReview(prepare(WRONG), 'ja').prompt).toContain('助词')
  expect(buildReview(prepare('Make this function async'), 'en').prompt).toContain('article')
})

test('a fix in Japanese is marked letter by letter, a Latin word as one', () => {
  expect(markChanges(WRONG, 'ファイルの読み込みに失敗しました', 'ja')).toEqual([
    { text: 'ファイル', isNew: false },
    { text: 'の', isNew: true },
    { text: '読み込みに失敗しました', isNew: false },
  ])
  expect(markChanges('README を更新', 'README を更新して', 'ja')).toEqual([
    { text: 'README を更新', isNew: false },
    { text: 'して', isNew: true },
  ])
  expect(markChanges('npm を使って', 'pnpm を使って', 'ja')).toEqual([
    { text: 'pnpm ', isNew: true },
    { text: 'を使って', isNew: false },
  ])
})

test('a change named in the note but not made in the text is made from the note', () => {
  const base = 'git ブランチが時々更新しない原因を見てください'
  const r = parseReview(
    `VERDICT: polish\nTEXT: ${base}\nNOTE: 用词: "ブランチが時々更新しない" → "ブランチが時々更新されない"`,
    prepare(base),
  )
  expect(r?.verdict).toBe('polish')
  expect(r?.text).toBe('git ブランチが時々更新されない原因を見てください')
  // Nothing named that is found: as before, it reads well.
  expect(parseReview(`VERDICT: polish\nTEXT: ${base}\nNOTE: 语体: "ます" → "です"`, prepare(base))?.verdict).toBe('ok')
})

test('a note naming two changes gives a card for each', () => {
  const t: Translation = {
    status: 'done',
    kind: 'review',
    verdict: 'fix',
    base: 'ファイルを読み込みに失敗しました、原因を検査してください',
    text: 'ファイルの読み込みに失敗しました。原因を確認してください',
    note: '助词: "ファイルを読み込みに失敗" → "ファイルの読み込みに失敗"; 用词: "検査して" → "確認して"',
  }
  expect(fromReview(t).map(f => [f.answer, f.why])).toEqual([
    ['ファイルの読み込みに失敗', '助词'],
    ['確認して', '用词'],
  ])
})

// --- in a session --------------------------------------------------------------------

test('a Chinese prompt gets its Japanese under the row, tagged JA', JA, async ($, on) => {
  const w = world(on)
  await start($)
  await submit($, ZH)
  await w.clock.settle()

  expect(w.asked.translate.length).toBe(1)
  expect(w.asked.translate[0]).toContain('natural Japanese')
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'prompt-en', surface, component: 'UserMessage', props: row(ZH) })
    expect(await ui.find({ type: 'Text', text: /^JA$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /念のため/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a Japanese prompt gets a review, the changed letter marked', JA, async ($, on) => {
  const w = world(on)
  await start($)
  await submit($, WRONG)
  await w.clock.settle()

  expect(w.asked.review.length).toBe(1)
  expect(w.asked.translate.length).toBe(0)
  const ui = await $.ui.mount({
    plugin: 'prompt-en',
    surface: 'terminal',
    component: 'UserMessage',
    props: row(WRONG),
    viewport: { columns: 120, rows: 40 },
  })
  expect(await ui.find({ type: 'Text', text: /^ ✎$/ })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /^の$/ }))?.props.color).toBe('success')
  expect(await ui.find({ type: 'Text', text: /助词/ })).toBeDefined()
  await ui.unmount()

  // The correction is a card, its kind as why.
  expect((await vocab($, 'list')).text).toContain('ファイルを読み込みに失敗 → ファイルの読み込みに失敗（助词）')
})

test('reviewEnglish off leaves Japanese prompts alone too', { options: { language: 'japanese', reviewEnglish: false } }, async ($, on) => {
  const w = world(on)
  await start($)
  await submit($, WRONG)
  await w.clock.settle()
  expect(w.asked.review.length).toBe(0)
})

test('an English answer kept before is not shown, nor its card, once Japanese is chosen', JA, async ($, on) => {
  const englishCard: VocabCard = {
    id: 'c1',
    kind: 'phrase',
    cue: '顺便',
    answer: "while you're at it",
    addedAt: NOW,
    seen: 1,
    box: 0,
    due: NOW,
    lapses: 0,
  }
  const w = world(on, {
    [`t:${keyOf(ZH)}`]: { status: 'done', kind: 'translate', text: 'Just in case, back up the database first.' },
    'v:c1': englishCard,
  })
  await start($)

  const before = await $.ui.mount({ plugin: 'prompt-en', surface: 'terminal', component: 'UserMessage', props: row(ZH) })
  expect(await before.find({ type: 'Text', text: /Just in case/ })).toBeUndefined()
  await before.unmount()
  expect((await vocab($, 'list')).text).toContain('日语生词本还是空的')

  await submit($, ZH)
  await w.clock.settle()
  expect(w.asked.translate.length).toBe(1)
  const after = await $.ui.mount({ plugin: 'prompt-en', surface: 'terminal', component: 'UserMessage', props: row(ZH) })
  expect(await after.find({ type: 'Text', text: /念のため/ })).toBeDefined()
  await after.unmount()
})

test('a Japanese answer is kept apart, so English finds none of it', async ($, on) => {
  const w = world(on, { [`ja:t:${keyOf(ZH)}`]: { status: 'done', kind: 'translate', text: ZH_JA } })
  await start($)
  const ui = await $.ui.mount({ plugin: 'prompt-en', surface: 'terminal', component: 'UserMessage', props: row(ZH) })
  expect(await ui.find({ type: 'Text', text: /念のため/ })).toBeUndefined()
  await ui.unmount()
  await submit($, ZH)
  await w.clock.settle()
  expect(w.asked.translate[0]).toContain('natural English')
})

// --- the vocabulary book ---------------------------------------------------------------

test('a phrase of a Japanese translation is kept with its reading', JA, async ($, on) => {
  const w = world(on)
  await start($)
  await submit($, ZH)
  await w.clock.settle()
  expect(w.asked.picks.length).toBe(1)
  expect(w.asked.picks[0]).toContain('learning Japanese')
  expect((await vocab($, 'list')).text).toContain('以防万一 → 念のため［ねんのため］')
})

test('a Japanese pick is kept only where it is worth a card', () => {
  const item = { source: ZH, target: ZH_JA }
  const reply = [
    'PHRASE: 以防万一 => 念のため => ねんのため',
    // A katakana loanword is a term.
    'PHRASE: 数据库 => データベース => でーたべーす',
    // The expression must be in the translation as it stands there.
    'PHRASE: 备份一下 => バックアップする => ばっくあっぷする',
  ].join('\n')
  expect(parsePicks(reply, [item], 'ja')[0]?.map(f => [f.cue, f.answer, f.reading])).toEqual([
    ['以防万一', '念のため', 'ねんのため'],
  ])

  // A reading that is the expression itself, or no kana, is left out.
  const kana = parsePicks('PHRASE: 先 => 先に => さきに\nPHRASE: 以防万一 => 念のため => nennotame', [item], 'ja')[0]
  expect(kana?.map(f => f.reading)).toEqual(['さきに', undefined])
  const plain = parsePicks('PHRASE: 顺便 => ついでに => ついでに', [{ source: '顺便加上超时', target: 'ついでにタイムアウトも追加して' }], 'ja')
  expect(plain[0]?.[0]?.reading).toBeUndefined()

  // Japanese the person typed among their Chinese is no cue.
  const typed = parsePicks('PHRASE: 念のため => 念のため => ねんのため', [{ source: '念のため备份一下', target: ZH_JA }], 'ja')
  expect(typed).toEqual([[]])
})

test('a Japanese pattern is a frame of a few letters of its own', () => {
  const item = { source: '等测试跑完之后再提交', target: 'テストが終わってからコミットしてください。' }
  const good = parsePicks(
    'PATTERN: 等测试跑完之后再提交 => テストが終わってからコミットしてください。 => ___が終わってから___してください',
    [item],
    'ja',
  )
  expect(good[0]?.[0]?.pattern).toBe('___が終わってから___してください')
  // Two letters of its own: too little to be a frame.
  const thin = parsePicks('PATTERN: 等测试跑完之后再提交 => テストが終わってからコミットしてください。 => ___が___', [item], 'ja')
  expect(thin).toEqual([[]])
})

test('a review note in Japanese quotes or with a full-width colon still pairs', () => {
  expect(parsePair('助词：「ファイルを読み込み」→「ファイルの読み込み」')).toEqual({
    cue: 'ファイルを読み込み',
    answer: 'ファイルの読み込み',
    why: '助词',
  })
  expect(parsePair('用词: "検査して" → "確認して"（中文的“检查”）')).toEqual({
    cue: '検査して',
    answer: '確認して',
    why: '用词 中文的“检查”',
  })
})

test('a Japanese phrase card shows its Japanese and reading under 日文', JA, async ($, on) => {
  const cue = '以防万一'
  const answer = '念のため'
  const id = cardId('phrase', cue, answer)
  world(on, {
    [`ja:v:${id}`]: {
      id,
      kind: 'phrase',
      cue,
      answer,
      reading: 'ねんのため',
      example: ZH_JA,
      addedAt: NOW,
      seen: 1,
      box: 0,
      due: NOW,
      lapses: 0,
    },
  })
  await start($)
  expect((await vocab($)).text).toContain('1 张待复习')
  const ui = await $.ui.mount({
    plugin: 'prompt-en',
    surface: 'terminal',
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
  })
  expect(await ui.find({ type: 'Text', text: /^中文/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /ねんのため/ })).toBeUndefined()
  await ui.press({ key: MAIN })
  expect(await ui.find({ type: 'Text', text: /^日文/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^读音/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ねんのため$/ })).toBeDefined()
  await ui.unmount()
})
