import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import type { DeckFile } from '../hooks/export'
import { toDeck } from '../hooks/export'
import { MAIN, cardId } from '../hooks/vocab'
import type { VocabCard } from '../types'

const NOW = 1_794_297_600_000
const USAGE = { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const HOME = '/home/u'
const DOCS = `${HOME}/Library/Mobile Documents/iCloud~com~kadaliao~snack/Documents`
const INBOX = `${DOCS}/Inbox`

const ZH = '帮我把这个函数改成异步的，顺便加上超时'
const ZH_EN = "Make this function async, and add a timeout while you're at it."

function card(over: Partial<VocabCard> & Pick<VocabCard, 'id' | 'kind' | 'cue' | 'answer'>): VocabCard {
  return { addedAt: NOW - 1000, seen: 1, box: 2, due: NOW + 5000, lapses: 1, ...over }
}

const PHRASE = card({ id: cardId('phrase', '顺便', "while you're at it"), kind: 'phrase', cue: '顺便', answer: "while you're at it" })
const FIX = card({
  id: cardId('fix', 'add timeout', 'add a timeout'),
  kind: 'fix',
  cue: 'add timeout',
  answer: 'add a timeout',
  why: 'article',
  seen: 2,
  addedAt: NOW - 2000,
})

// The engine beneath: a store, a clock, and a disk where the app's iCloud folder
// is there or not, with `mv` to move a file into it.
function world(on: On, opts: { entries?: Record<string, unknown>; hasFolder?: boolean; canRun?: boolean } = {}) {
  const { entries, hasFolder = true, canRun = true } = opts
  const clock = mock.clock(on, { now: NOW })
  mock.store(on, entries)
  mock.env(on, { HOME, TMPDIR: '/tmp/x/' })
  const files = new Map<string, string>()
  const writes: string[] = []
  const asked: string[] = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('fs.exists', (_, e) => {
    asked.push(e.path)
    return { value: (hasFolder && (e.path === DOCS || e.path === INBOX)) || files.has(e.path) }
  })
  on('fs.read', (_, e) => {
    const text = files.get(e.path)
    if (text === undefined) throw new Error('ENOENT')
    return { value: text }
  })
  on('fs.write', (_, e) => {
    files.set(e.path, e.text)
    writes.push(e.path)
    return { value: undefined }
  })
  on('process.run', (_, e) => {
    if (!canRun) throw new Error('no commands here')
    const [command, , from = '', to = ''] = e.argv
    const text = files.get(from)
    if (command !== 'mv' || text === undefined) return { value: { exitCode: 1, stdout: '', stderr: 'no such file', isStdoutTruncated: false, isStderrTruncated: false } }
    files.delete(from)
    files.set(to, text)
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [{ id: 'vocab', title: '生词本', isShown: true, isPlaced: true, isFocused: true }] }))
  on('model.complete', (_, e) => {
    const text = e.system?.includes('worth learning') ? "PHRASE: 顺便 => while you're at it" : ZH_EN
    return { value: { isAnswered: true, text, usage: USAGE } }
  })
  // The deck in the Inbox, read back.
  const deck = () => {
    const found = [...files.entries()].find(([path]) => path.startsWith(`${INBOX}/`))
    return found ? { path: found[0], file: JSON.parse(found[1]) as DeckFile } : undefined
  }
  return { clock, files, writes, asked, deck }
}

async function start($: Engine) {
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
}

const vocab = ($: Engine, args = '') =>
  $.command.run({ command: 'vocab', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })

test('a card becomes a deck card: what it teaches, and nothing of how well it is known', () => {
  const deck = toDeck([PHRASE, FIX], [], 'en', NOW)
  expect(deck.format).toBe('deck/1')
  expect(deck.deck).toEqual(
    expect.objectContaining({ id: 'prompt-en.en', source: 'prompt-en', lang: { target: 'en', native: 'zh' }, updatedAt: '2026-11-10T08:00:00.000Z' }),
  )
  // The earliest added first.
  expect(deck.cards.map(c => c.kind)).toEqual(['fix', 'phrase'])
  expect(deck.cards[0]).toEqual({
    id: FIX.id,
    kind: 'fix',
    front: 'add timeout',
    back: 'add a timeout',
    why: 'article',
    seen: 2,
    addedAt: '2026-11-10T07:59:58.000Z',
  })
  expect(JSON.stringify(deck)).not.toContain('"box"')
  expect(JSON.stringify(deck)).not.toContain('"due"')
})

test('a card deleted in /vocab is named deleted, unless it was filed again since', () => {
  const gone = { id: 'gone', kind: 'phrase' as const, cue: '兜底', answer: 'fall back to' }
  const back = { id: PHRASE.id, kind: 'phrase' as const, cue: '顺便', answer: "while you're at it" }
  const deck = toDeck([PHRASE], [gone, back], 'en')
  expect(deck.cards).toHaveLength(2)
  expect(deck.cards[1]).toEqual({ id: 'gone', kind: 'phrase', front: '兜底', back: 'fall back to', deleted: true })
  expect(deck.deck.updatedAt).toBeUndefined()
})

test('/vocab export writes the book into the app’s iCloud Inbox, moved in whole', async ($, on) => {
  const w = world(on, { entries: { [`v:${PHRASE.id}`]: PHRASE, [`v:${FIX.id}`]: FIX } })
  await start($)
  const ran = await vocab($, 'export')
  const deck = w.deck()
  expect(deck?.path).toMatch(new RegExp(`^${INBOX}/prompt-en\\.en\\.[a-z0-9]{6}\\.deck\\.json$`))
  expect(deck?.file.cards.map(c => c.front)).toEqual(['add timeout', '顺便'])
  expect(ran.text).toContain('已导出 2 张')
  // Written beside it first, then moved in.
  expect(w.writes.every(path => path.startsWith('/tmp/x/'))).toBe(true)
  expect([...w.files.keys()].filter(path => path.startsWith('/tmp/'))).toEqual([])
})

test('the same book is not written again; a new card is', async ($, on) => {
  const w = world(on, { entries: { [`v:${FIX.id}`]: FIX } })
  await start($)
  await vocab($, 'export')
  const first = w.writes.length
  await w.clock.advance(5000)
  expect((await vocab($, 'export')).text).toContain('没有变化（1 张）')
  expect(w.writes.length).toBe(first)

  // A prompt files a phrase.
  await $.prompt.submit({ text: ZH, origin: { kind: 'composer' }, wait: false })
  await w.clock.settle()
  expect((await vocab($, 'export')).text).toContain('已导出 2 张')
  expect(w.writes.length).toBe(first + 1)
  // The same file, the machine's own: one file in the Inbox.
  expect([...w.files.keys()].filter(path => path.startsWith(INBOX))).toHaveLength(1)
})

test('nothing is written before iCloud has made the app’s folder', async ($, on) => {
  const w = world(on, { entries: { [`v:${PHRASE.id}`]: PHRASE }, hasFolder: false })
  await start($)
  await w.clock.settle()
  const ran = await vocab($, 'export')
  expect(ran.text).toContain(`没有 ${DOCS}`)
  expect(w.writes).toEqual([])
})

test('where commands cannot run, the file is written in place', async ($, on) => {
  const w = world(on, { entries: { [`v:${PHRASE.id}`]: PHRASE }, canRun: false })
  await start($)
  await vocab($, 'export')
  expect(w.deck()?.file.cards).toHaveLength(1)
})

test('an empty exportDir exports nothing', { options: { exportDir: '' } }, async ($, on) => {
  const w = world(on, { entries: { [`v:${PHRASE.id}`]: PHRASE } })
  await start($)
  await w.clock.settle()
  expect((await vocab($, 'export')).text).toContain('exportDir 选项是空的')
  expect(w.asked).toEqual([])
  expect(w.writes).toEqual([])
})

test('the book is exported at the start, and a card filed later within the minute', async ($, on) => {
  const w = world(on)
  await start($)
  await w.clock.settle()
  expect(w.deck()?.file.cards).toEqual([])

  await $.prompt.submit({ text: ZH, origin: { kind: 'composer' }, wait: false })
  await w.clock.settle()
  // Written at the start a moment ago: the card waits for the minute to be up.
  expect(w.deck()?.file.cards).toEqual([])
  await w.clock.advance(60_000)
  expect(w.deck()?.file.cards.map(c => c.back)).toEqual(["while you're at it"])
})

test('a card deleted in the pane is exported as deleted', async ($, on) => {
  const w = world(on, { entries: { [`v:${PHRASE.id}`]: { ...PHRASE, due: NOW - 1 } } })
  await start($)
  await vocab($)
  const ui = await $.ui.mount({
    plugin: 'prompt-en',
    component: 'Pane',
    requestId: 'vocab',
    surface: 'terminal',
    props: { title: '生词本', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  })
  await ui.press({ key: MAIN })
  await ui.press({ key: 'drop' })
  await ui.unmount()
  await vocab($, 'export')
  expect(w.deck()?.file.cards).toEqual([{ id: PHRASE.id, kind: 'phrase', front: '顺便', back: "while you're at it", deleted: true }])
})

test('learning Japanese, the Japanese book is a deck of its own', { options: { language: 'japanese' } }, async ($, on) => {
  const ja = card({ id: 'j1', kind: 'phrase', cue: '以防万一', answer: '念のため', reading: 'ねんのため' })
  const w = world(on, { entries: { 'ja:v:j1': ja, [`v:${PHRASE.id}`]: PHRASE } })
  await start($)
  expect((await vocab($, 'export')).text).toContain('日语生词本已导出 1 张')
  const deck = w.deck()
  expect(deck?.path).toMatch(/prompt-en\.ja\.[a-z0-9]{6}\.deck\.json$/)
  expect(deck?.file.deck.id).toBe('prompt-en.ja')
  expect(deck?.file.cards[0]?.reading).toBe('ねんのため')
})
