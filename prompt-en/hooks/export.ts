import type { EngineInterface } from 'claude-code'

import type { VocabCard } from '../types'
import type { Lang } from './lang'
import { loadDeck, loadDropped } from './book'
import type { Dropped } from './book'

// The vocabulary book, written out as a deck for Snack (卡片零食), the flashcard app
// on the phone: https://github.com/kadaliao/snack/blob/main/spec/deck-format.md
//
// The deck goes into the app's iCloud folder, which iCloud brings to the phone. The
// file holds what each card teaches and nothing of how well it is known: progress is
// the app's own. It is the whole book each time, written only when it changed, and
// never into a folder iCloud has not made: a folder made by hand there does not sync.

export const DEFAULT_EXPORT_DIR = '~/Library/Mobile Documents/iCloud~com~kadaliao~snack/Documents/Inbox'
// Writes at most this often as cards come in.
const EVERY_MS = 60_000
const MACHINE_KEY = 'export:machine'

export type DeckCard = {
  id: string
  kind: VocabCard['kind']
  front: string
  back: string
  reading?: string
  context?: string
  example?: string
  why?: string
  pattern?: string
  seen?: number
  addedAt?: string
  deleted?: true
}

export type DeckFile = {
  format: 'deck/1'
  deck: {
    id: string
    title: string
    source: 'prompt-en'
    lang: { target: Lang; native: 'zh' }
    description: string
    updatedAt?: string
  }
  cards: DeckCard[]
}

const TITLE: Record<Lang, string> = { en: 'prompt-en · 英语', ja: 'prompt-en · 日语' }
const DESCRIPTION: Record<Lang, string> = {
  en: '写 prompt 时 prompt-en 教过的英语：纠错、地道的表达和句型',
  ja: '写 prompt 时 prompt-en 教过的日语：纠错、地道的表达和句型',
}

// The book as a deck: its cards, the earliest first, and a card deleted in /vocab
// marked so, so the app hides it too. A card trimmed for room is only left out, and
// the app keeps it.
export function toDeck(cards: readonly VocabCard[], dropped: readonly Dropped[], lang: Lang, updatedAt?: number): DeckFile {
  const kept = new Set(cards.map(c => c.id))
  const live: DeckCard[] = [...cards]
    .sort((a, b) => a.addedAt - b.addedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(c => ({
      id: c.id,
      kind: c.kind,
      front: c.cue,
      back: c.answer,
      reading: c.reading,
      context: c.context,
      example: c.example,
      why: c.why,
      pattern: c.pattern,
      seen: c.seen,
      addedAt: new Date(c.addedAt).toISOString(),
    }))
  const gone: DeckCard[] = dropped
    .filter(d => !kept.has(d.id))
    .map(d => ({ id: d.id, kind: d.kind, front: d.cue, back: d.answer, deleted: true }))
  return {
    format: 'deck/1',
    deck: {
      id: `prompt-en.${lang}`,
      title: TITLE[lang],
      source: 'prompt-en',
      lang: { target: lang, native: 'zh' },
      description: DESCRIPTION[lang],
      ...(updatedAt !== undefined ? { updatedAt: new Date(updatedAt).toISOString() } : {}),
    },
    cards: [...live, ...gone],
  }
}

// A deck's text without its time, to tell whether anything else changed.
function body(text: string): string | undefined {
  try {
    const deck = JSON.parse(text) as DeckFile
    return JSON.stringify({ ...deck, deck: { ...deck.deck, updatedAt: undefined } })
  } catch {
    return undefined
  }
}

// `~` as the home folder; undefined where there is no home to put there.
export function expandHome(dir: string, home: string | undefined): string | undefined {
  if (dir !== '~' && !dir.startsWith('~/')) return dir
  return home === undefined ? undefined : home + dir.slice(1)
}

const parentOf = (path: string) => path.replace(/\/+$/, '').replace(/\/[^/]*$/, '') || '/'

export type Exported =
  | { status: 'written' | 'unchanged'; path: string; cards: number }
  | { status: 'no-folder'; folder: string }
  | { status: 'off' }
  | { status: 'failed'; error: string }

// This Mac, as the name of its file: the two Macs a person has may share a hostname,
// and each writes a file of its own to the one deck.
async function machineOf($: EngineInterface): Promise<string> {
  const kept = await $.store.get(MACHINE_KEY)
  if (typeof kept === 'string' && kept !== '') return kept
  const made = Math.random().toString(36).slice(2, 8).padEnd(6, '0')
  await $.store.set(MACHINE_KEY, made)
  return made
}

// Writes the book to `<dir>/prompt-en.<lang>.<machine>.deck.json`, when its folder's
// parent exists (for the app's Inbox: the container iCloud made) and the cards changed.
export async function exportDeck($: EngineInterface, dir: string, lang: Lang): Promise<Exported> {
  if (dir.trim() === '') return { status: 'off' }
  const folder = expandHome(dir.trim(), await $.env.get('HOME'))
  if (folder === undefined) return { status: 'failed', error: 'no HOME to put for ~' }
  const parent = parentOf(folder)
  if (!(await $.fs.exists(parent))) return { status: 'no-folder', folder: parent }

  const cards = await loadDeck($, lang)
  const path = `${folder.replace(/\/+$/, '')}/prompt-en.${lang}.${await machineOf($)}.deck.json`
  const dropped = await loadDropped($, lang)
  const deck = toDeck(cards, dropped, lang)
  const old = await $.fs.read(path).then(
    text => (typeof text === 'string' ? body(text) : undefined),
    () => undefined,
  )
  if (old !== undefined && old === body(JSON.stringify(deck))) return { status: 'unchanged', path, cards: cards.length }

  const text = `${JSON.stringify(toDeck(cards, dropped, lang, await $.clock.now()), null, 2)}\n`
  try {
    await place($, path, text)
  } catch (e) {
    return { status: 'failed', error: e instanceof Error ? e.message : String(e) }
  }
  return { status: 'written', path, cards: cards.length }
}

// Writes the file whole: next to it first, outside the synced folder, then moved in, so
// iCloud never sends the phone half of it. Where commands cannot run, written in place.
async function place($: EngineInterface, path: string, text: string): Promise<void> {
  const tmp = `${(await $.env.get('TMPDIR')) ?? '/tmp'}`.replace(/\/+$/, '') + `/${path.split('/').pop()}.tmp`
  try {
    await $.fs.write(tmp, text)
    const moved = await $.process.run(['mv', '-f', tmp, path])
    if (moved.exitCode === 0) return
  } catch {
    // No commands here: below.
  }
  await $.fs.write(path, text)
}

export function exportedText(r: Exported, lang: Lang): string {
  const book = lang === 'en' ? '生词本' : '日语生词本'
  switch (r.status) {
    case 'written':
      return `${book}已导出 ${r.cards} 张 → ${r.path}\n手机上的卡片零食会通过 iCloud 收到。`
    case 'unchanged':
      return `${book}没有变化（${r.cards} 张），已经在 ${r.path}`
    case 'no-folder':
      return `${book}没有导出：没有 ${r.folder}。先在 iPhone 上装好卡片零食并打开一次，等 iCloud 把它的文件夹同步到这台 Mac；或者在插件选项（/config）里把 exportDir 改成别的文件夹。`
    case 'off':
      return `${book}没有导出：exportDir 选项是空的。`
    case 'failed':
      return `${book}导出失败：${r.error}`
  }
}

// Where the book goes, and when it last went there.
export type ExportState = {
  dir: string
  lang: Lang
  last: number
  isPending: boolean
}

export const exportState = (dir: string, lang: Lang): ExportState => ({
  dir,
  lang,
  last: Number.NEGATIVE_INFINITY,
  isPending: false,
})

// Writes now.
export async function exportNow($: EngineInterface, s: ExportState): Promise<Exported> {
  s.last = await $.clock.now()
  return exportDeck($, s.dir, s.lang)
}

// Writes now, and says how it went.
export async function exportReport($: EngineInterface, s: ExportState): Promise<string> {
  return exportedText(await exportNow($, s), s.lang)
}

// Writes soon: at once if it has not written in the last minute, else when the
// minute is up, once for everything filed meanwhile.
export function exportSoon($: EngineInterface, s: ExportState): void {
  if (s.dir.trim() === '' || s.isPending) return
  s.isPending = true
  void (async () => {
    const wait = Math.max(0, s.last + EVERY_MS - (await $.clock.now()))
    $.clock.after(wait, () => {
      s.isPending = false
      void exportNow($, s).catch(() => {})
    })
  })().catch(() => {
    s.isPending = false
  })
}
