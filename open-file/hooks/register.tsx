import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { View } from '../types'
import { fileHref, findHits, linkify, parseHref, resolvePath } from './paths'
import type { Hit } from './paths'

// Each file opens in a pane of its own, its id this prefix and a hash of the
// path; with more than one open the surface draws them as tabs.
const TAB_PREFIX = 'of-'
// The most files open at once: one more closes the oldest.
const MOST_TABS = 8
// The dock's width it asks for; the layout gives at most 45% of the terminal.
const PANE_COLUMNS = 120
// The characters of source one drawing shows (a tree draws 100,000 in all):
// past it, the lines around the one asked for.
const BUDGET = 90_000
// Files bigger than this are read from their start only.
const MOST_BYTES = 2 * 1024 * 1024
// Waits before each try to bring the line into view, while the new tree lands.
const REVEAL_WAITS_MS = [20, 80, 200, 500, 1000]
// Recently read files, by absolute path.
const KEEP_FILES = 8
// The tools whose call changes a file the pane may show.
const EDITS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

// A family: what each tab shows, by its pane id.
const tabs = atom({ plugin: 'open-file', key: 'tab' } as const, { path: '', seq: 0, rev: 0 }, { shape: 'tab-1' })

// The pane id a file opens under: the same file, the same tab.
export function tabIdOf(abs: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < abs.length; i++) {
    hash ^= abs.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `${TAB_PREFIX}${hash.toString(16).padStart(8, '0')}`
}

// A tab's label: the file's name, or its folder and name where another open
// tab already has that name.
function titleOf(abs: string, taken: readonly string[]): string {
  const parts = abs.split('/').filter(p => p !== '')
  const name = parts[parts.length - 1] ?? abs
  return taken.includes(name) ? parts.slice(-2).join('/') : name
}

type Loaded = { mtimeMs: number; size: number } & ({ text: string; isCut: boolean } | { error: string })

// Absolute paths found to be files; a miss is asked again at the next drawing.
const files = new Set<string>()
const loaded = new Map<string, Loaded>()
let home: string | undefined

async function homeOf($: EngineInterface): Promise<string | undefined> {
  home ??= await $.env.get('HOME')
  return home
}

async function isFile($: EngineInterface, abs: string): Promise<boolean> {
  if (files.has(abs)) return true
  const stat = await $.fs.stat(abs).catch(() => undefined)
  if (stat?.kind !== 'file') return false
  files.add(abs)
  return true
}

// The file's text, read again only when it changed.
async function load($: EngineInterface, abs: string): Promise<Loaded> {
  const stat = await $.fs.stat(abs).catch(() => undefined)
  if (stat === undefined) {
    const isThere = await $.fs.exists(abs).catch(() => true)
    return { mtimeMs: 0, size: 0, error: isThere ? '打不开这个文件' : '文件不存在了' }
  }
  if (stat.kind !== 'file') return { mtimeMs: 0, size: 0, error: '不是文件' }
  const was = loaded.get(abs)
  if (was !== undefined && was.mtimeMs === stat.mtimeMs && was.size === stat.size) return was
  const isCut = stat.size > MOST_BYTES
  const text = await $.fs.read(abs, isCut ? { length: MOST_BYTES } : {}).catch((no: Error) => no)
  let now: Loaded
  if (text instanceof Error) now = { mtimeMs: stat.mtimeMs, size: stat.size, error: text.message }
  else if (text.slice(0, 8000).includes('\u0000')) now = { mtimeMs: stat.mtimeMs, size: stat.size, error: `二进制文件（${sizeOf(stat.size)}），不显示内容` }
  else now = { mtimeMs: stat.mtimeMs, size: stat.size, text, isCut }
  loaded.delete(abs)
  loaded.set(abs, now)
  for (const old of loaded.keys()) {
    if (loaded.size <= KEEP_FILES) break
    loaded.delete(old)
  }
  return now
}

const digits = (n: number) => String(n).length

function sizeOf(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// The path as the person reads it: under the session's directory, relative.
function shortPath(abs: string, cwd: string, home: string | undefined): string {
  if (abs.startsWith(`${cwd}/`)) return abs.slice(cwd.length + 1)
  if (home !== undefined && home !== '' && abs.startsWith(`${home}/`)) return `~${abs.slice(home.length)}`
  return abs
}

// The lines a drawing shows: all of them, or as many around `line` as the
// budget holds. `first` and `last` are 0-based and inclusive.
export function windowOf(lines: readonly string[], line: number | undefined, budget = BUDGET): { first: number; last: number } {
  const total = lines.reduce((n, l) => n + l.length + 1, 0)
  if (total <= budget) return { first: 0, last: lines.length - 1 }
  const cost = (i: number) => (lines[i]?.length ?? 0) + 1
  const at = Math.min(Math.max((line ?? 1) - 1, 0), lines.length - 1)
  let first = at
  let last = at
  let used = cost(at)
  for (let isGrowing = true; isGrowing; ) {
    isGrowing = false
    if (last + 1 < lines.length && used + cost(last + 1) <= budget) {
      last += 1
      used += cost(last)
      isGrowing = true
    }
    if (first > 0 && used + cost(first - 1) <= budget) {
      first -= 1
      used += cost(first)
      isGrowing = true
    }
  }
  return { first, last }
}

// Shows the file a link names in its tab, opened or brought forward, and
// brings its line into view.
async function openLink($: EngineInterface, href: string): Promise<void> {
  const ref = parseHref(href)
  if (ref === undefined) return
  const id = tabIdOf(ref.path)
  const now = await update($, memberOf(tabs, { requestId: id }), old => ({
    path: ref.path,
    ...(ref.line === undefined ? {} : { line: ref.line }),
    seq: old.path === ref.path ? old.seq + 1 : 1,
    rev: old.rev,
  }))
  const mine = (await $.ui.panes()).filter(p => p.id.startsWith(TAB_PREFIX))
  const was = mine.find(p => p.id === id)
  const others = mine.filter(p => p.id !== id)
  // One more file than the most closes the one opened first.
  if (was === undefined) for (const old of others.slice(0, Math.max(0, others.length - MOST_TABS + 1))) await $.ui.close({ id: old.id })
  const title = was?.title ?? titleOf(ref.path, others.map(p => p.title))
  // Opening an open pane only retitles it: one behind another tab is closed
  // and opened again, which shows it (as the last tab) without taking the keys.
  if (was !== undefined && !was.isShown) await $.ui.close({ id })
  await $.ui.open({ id, title, columns: PANE_COLUMNS, closeOnEscape: true })
  void reveal($, id, now).catch(() => undefined)
}

// Scrolls a tab to the line the click named, or to the top, once the tree
// drawn for that click is up (its keys carry the click's `seq`).
async function reveal($: EngineInterface, id: string, v: View): Promise<void> {
  const key = v.line === undefined ? `top-${v.seq}` : `at-${v.seq}`
  for (const ms of REVEAL_WAITS_MS) {
    await $.clock.sleep(ms)
    const moved = await $.ui.scroll({ in: id, to: { key }, block: v.line === undefined ? 'start' : 'center' }).catch(() => ({ deny: 'failed' }))
    if (moved.deny === undefined) return
    if ((await read($, memberOf(tabs, { requestId: id }))).seq !== v.seq) return
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // Where Claude Code does not know the terminal draws links (herdr, say),
    // it draws each as its text then the URL, and a click on the text opens
    // nothing: this has it draw them as links, the text alone.
    if ((await $.env.get('FORCE_HYPERLINK')) === undefined) await $.env.set('FORCE_HYPERLINK', '1')
    return next(e)
  })

  // A reply's text: the paths in it that are files become links the pane
  // answers. Only where a plain click reaches the mod: the fullscreen terminal.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.viewport?.isFullscreen !== true || e.props.isSummary === true) return next(e)
    const hits = findHits(e.props.text)
    if (hits.length === 0) return next(e)
    const cwd = await $.session.cwd()
    const homeDir = await homeOf($)
    const hrefs = new Map<Hit, string>()
    await Promise.all(
      hits.map(async hit => {
        const abs = resolvePath(hit.path, cwd, homeDir)
        if (abs !== undefined && (await isFile($, abs))) hrefs.set(hit, fileHref(abs, hit.line))
      }),
    )
    if (hrefs.size === 0) return next(e)
    const linked = linkify(e.props.text, hits, hit => hrefs.get(hit))
    // A surface may hand a press back with the target decoded: both answer.
    const pressable = [...new Set(linked.hrefs.flatMap(href => [href, decodeURI(href)]))].slice(0, 256)
    const { Box, Text, Markdown } = $.ui.resolve(e)

    return (
      <Box flexDirection="row">
        <Box minWidth={2} flexShrink={0}>
          <Text color="text">{e.props.isFirstOfReply ? '⏺' : ' '}</Text>
        </Box>
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
          <Markdown key={`reply-${e.requestId}`} text={linked.text} pressableLinks={pressable} onLinkPress={link => openLink($, link.href)} />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (!e.requestId.startsWith(TAB_PREFIX)) return next(e)
    const { Box, Text, Code } = $.ui.resolve(e)
    const v = await read($, memberOf(tabs, { requestId: e.requestId }))
    if (v.path === '') return <Text dimColor>这个标签页忘了它打开的文件，在会话里再点一次路径</Text>
    const cwd = await $.session.cwd()
    const homeDir = await homeOf($)
    const file = await load($, v.path)
    const where = `${shortPath(v.path, cwd, homeDir)}${v.line === undefined ? '' : `:${v.line}`}`
    if ('error' in file) {
      return (
        <Box key={`top-${v.seq}`} flexDirection="column">
          <Text bold wrap="truncate-start">{where}</Text>
          <Text dimColor>{file.error}</Text>
        </Box>
      )
    }
    const lines = file.text.split('\n')
    if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
    const { first, last } = windowOf(lines, v.line)
    const at = v.line === undefined || v.line > lines.length ? undefined : v.line - 1
    const note = [
      `${lines.length} 行`,
      first > 0 || last < lines.length - 1 ? `显示第 ${first + 1}–${last + 1} 行` : '',
      file.isCut ? `只读了前 ${sizeOf(MOST_BYTES)}` : '',
      v.line !== undefined && at === undefined ? `没有第 ${v.line} 行` : '',
    ].filter(s => s !== '').join(' · ')
    // Each Code sizes its gutter to its own last number: a part that ends on
    // fewer digits than the last part is padded, so the numbers line up.
    const part = (from: number, to: number) => (
      <Box paddingLeft={digits(last + 1) - digits(to + 1)}>
        <Code path={v.path} source={lines.slice(from, to + 1).join('\n')} startLine={from + 1} />
      </Box>
    )
    const isEmpty = file.text === ''

    return (
      <Box flexDirection="column">
        <Box key={`top-${v.seq}`} flexDirection="column" marginBottom={1}>
          <Text bold wrap="truncate-start">{where}</Text>
          <Text dimColor>{isEmpty ? '空文件' : note}</Text>
        </Box>
        {!isEmpty && (at === undefined || at < first || at > last
          ? part(first, last)
          : [
              at > first && part(first, at - 1),
              <Box key={`at-${v.seq}`} backgroundColor="subtle">{part(at, at)}</Box>,
              at < last && part(at + 1, last),
            ])}
      </Box>
    )
  })

  // Claude edited a file a tab shows: draw it again.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (!EDITS.has(String(e.tool))) return ran
    const input = e as unknown as { file_path?: unknown; notebook_path?: unknown }
    const written = typeof input.file_path === 'string' ? input.file_path : input.notebook_path
    if (typeof written !== 'string') return ran
    void (async () => {
      const abs = resolvePath(written, await $.session.cwd(), await homeOf($))
      if (abs === undefined) return
      const tab = memberOf(tabs, { requestId: tabIdOf(abs) })
      if ((await read($, tab)).path === abs) await update($, tab, old => ({ ...old, rev: old.rev + 1 }))
    })().catch(() => undefined)

    return ran
  }).catch(($, e, next) => next(e))
}
