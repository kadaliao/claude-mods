import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, ImageSource, Register, RenderElement, RenderInput } from 'claude-code'

import type { View } from '../types'
import { BASE_SIDE, base64ToBytes, decodePicture, fitBox, isPicturePath, sniff, sourceOf } from './image'
import type { Rgba } from './image'
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
// Picture files bigger than this are not read whole: sips shrinks them first.
const MOST_PICTURE_BYTES = 40 * 1024 * 1024
// $.fs.read gives at most 4 MiB at once.
const CHUNK = 3 * 1024 * 1024
// Recently decoded pictures, and recently drawn turns and sizes of them.
const KEEP_PICTURES = 3
const KEEP_SOURCES = 6
// The rows above a picture: its path, the line under it, the buttons and a gap.
const PICTURE_HEAD_ROWS = 4
// macOS's image tool: it reads GIF, WebP, HEIC and the rest, and writes PNG.
const SIPS = '/usr/bin/sips'

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

// A picture's pixels, upright and no larger than a pane uses, its size as the
// person sees it and its format; or why it cannot be drawn.
type Drawable = { pixels: Rgba; width: number; height: number; format: string }
type Picture = { mtimeMs: number; size: number } & (Drawable | { error: string })

const pictures = new Map<string, Picture>()
// Decodes under way, by path and version: two drawings wait on one.
const decoding = new Map<string, Promise<Picture>>()
const sources = new Map<string, ImageSource>()

function keepLast<V>(map: Map<string, V>, key: string, value: V, most: number): V {
  map.delete(key)
  map.set(key, value)
  for (const old of map.keys()) {
    if (map.size <= most) break
    map.delete(old)
  }
  return value
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err))

// The bytes of a file `size` bytes long, a few MiB at a time.
async function readBytes($: EngineInterface, abs: string, size: number): Promise<Uint8Array> {
  const out = new Uint8Array(size)
  let at = 0
  while (at < size) {
    const { base64 } = await $.fs.read(abs, { as: 'bytes', offset: at, length: Math.min(CHUNK, size - at) })
    const part = base64ToBytes(base64)
    if (part.length === 0) break
    out.set(part.subarray(0, size - at), at)
    at += part.length
  }
  return at < size ? out.subarray(0, at) : out
}

// A picture the decoders here do not read, as macOS's sips turns it into a PNG
// in the temporary folder, no larger than a pane uses.
async function viaSips($: EngineInterface, abs: string, mtimeMs: number): Promise<Drawable> {
  const asked = await $.process.run([SIPS, '-g', 'pixelWidth', '-g', 'pixelHeight', abs], { timeoutMs: 15_000 }).catch(() => undefined)
  if (asked === undefined) throw new Error('这种格式的图片要用 macOS 的 sips 转换才能显示')
  const w = Number(/pixelWidth: (\d+)/.exec(asked.stdout)?.[1] ?? 0)
  const h = Number(/pixelHeight: (\d+)/.exec(asked.stdout)?.[1] ?? 0)
  if (!(w > 0 && h > 0)) throw new Error('读不出这张图片')
  const tmp = `${((await $.env.get('TMPDIR')) ?? '/tmp').replace(/\/+$/, '')}/open-file-${tabIdOf(abs)}-${Math.round(mtimeMs)}.png`
  try {
    const shrink = Math.max(w, h) > BASE_SIDE ? ['-Z', String(BASE_SIDE)] : []
    const made = await $.process.run([SIPS, '-s', 'format', 'png', ...shrink, abs, '--out', tmp], { timeoutMs: 60_000 })
    if (made.exitCode !== 0) throw new Error('sips 没能转换这张图片')
    const { pixels } = decodePicture(await readBytes($, tmp, (await $.fs.stat(tmp)).size))
    // The size sips reads is as stored: where it set the picture upright, say so.
    const isTurned = w !== h && pixels.width !== pixels.height && w > h !== pixels.width > pixels.height
    const format = abs.slice(abs.lastIndexOf('.') + 1).toUpperCase()
    return { pixels, width: isTurned ? h : w, height: isTurned ? w : h, format }
  } finally {
    await $.process.run(['/bin/rm', '-f', tmp]).catch(() => undefined)
  }
}

async function decodeFile($: EngineInterface, abs: string, mtimeMs: number, size: number): Promise<Picture> {
  let why: string | undefined
  if (size <= MOST_PICTURE_BYTES) {
    try {
      const bytes = await readBytes($, abs, size)
      if (sniff(bytes) !== 'other') return { mtimeMs, size, ...decodePicture(bytes) }
    } catch (err) {
      why = messageOf(err)
    }
  }
  // GIF, WebP, HEIC and the rest, and what the decoders refuse (a CMYK JPEG).
  try {
    return { mtimeMs, size, ...(await viaSips($, abs, mtimeMs)) }
  } catch (err) {
    return { mtimeMs, size, error: `显示不了这张图片：${why ?? messageOf(err)}` }
  }
}

// The picture's pixels, decoded again only when the file changed.
async function loadPicture($: EngineInterface, abs: string): Promise<Picture> {
  const stat = await $.fs.stat(abs).catch(() => undefined)
  if (stat === undefined) {
    const isThere = await $.fs.exists(abs).catch(() => true)
    return { mtimeMs: 0, size: 0, error: isThere ? '打不开这个文件' : '文件不存在了' }
  }
  if (stat.kind !== 'file') return { mtimeMs: 0, size: 0, error: '不是文件' }
  const was = pictures.get(abs)
  if (was !== undefined && was.mtimeMs === stat.mtimeMs && was.size === stat.size) return was
  const key = `${abs}|${stat.mtimeMs}|${stat.size}`
  let job = decoding.get(key)
  if (job === undefined) {
    job = decodeFile($, abs, stat.mtimeMs, stat.size).finally(() => decoding.delete(key))
    decoding.set(key, job)
  }
  return keepLast(pictures, abs, await job, KEEP_PICTURES)
}

// Quarter turns clockwise the person gave a tab's picture, 0 to 3.
const turnsOf = (v: View) => (((v.turns ?? 0) % 4) + 4) % 4

function turnBy($: EngineInterface, id: string, by: number | 'back'): Promise<unknown> {
  return update($, memberOf(tabs, { requestId: id }), old => ({ ...old, turns: by === 'back' ? 0 : (turnsOf(old) + by + 4) % 4 }))
}

const TURNED = ['', '向右转了 90°', '转了 180°', '向左转了 90°']

// A tab that shows a picture: as large as the pane holds it, turned as the
// person turned it with the buttons above it.
async function pictureTab($: EngineInterface, e: RenderInput<'Pane'>, v: View, where: string): Promise<RenderElement> {
  const said = (words: string) => {
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box key={`top-${v.seq}`} flexDirection="column">
        <Text bold wrap="truncate-start">{where}</Text>
        <Text dimColor>{words}</Text>
      </Box>
    )
  }
  if (e.surface !== 'terminal') return said('图片只在终端里显示')
  const { Box, Text, Button, Image } = $.ui.resolve(e)
  const pic = await loadPicture($, v.path)
  if ('error' in pic) return said(pic.error)
  const turns = turnsOf(v)
  const isSideways = turns % 2 === 1
  const { columns, rows } = fitBox(
    isSideways ? pic.height : pic.width,
    isSideways ? pic.width : pic.height,
    e.props.bodyColumns,
    Math.max(4, e.props.scroll.bodyRows - PICTURE_HEAD_ROWS),
  )
  const key = `${v.path}|${pic.mtimeMs}|${pic.size}|${turns}|${columns}x${rows}`
  const source = sources.get(key) ?? keepLast(sources, key, sourceOf(pic.pixels, turns, columns, rows), KEEP_SOURCES)
  const note = [`${pic.width}×${pic.height}`, pic.format, sizeOf(pic.size), TURNED[turns]].filter(s => s !== '').join(' · ')
  const name = v.path.slice(v.path.lastIndexOf('/') + 1)
  const press = (by: number | 'back') => () => void turnBy($, e.requestId, by).catch(() => undefined)

  return (
    <Box flexDirection="column">
      <Box key={`top-${v.seq}`} flexDirection="column">
        <Text bold wrap="truncate-start">{where}</Text>
        <Text dimColor>{note}</Text>
      </Box>
      <Box flexDirection="row" columnGap={2} marginBottom={1}>
        <Button key="turn-left" label="↺ 左转" hotkey="l" onPress={press(-1)} />
        <Button key="turn-right" label="↻ 右转" hotkey="r" onPress={press(1)} />
        {turns !== 0 && <Button key="turn-back" label="还原" hotkey="0" onPress={press('back')} />}
      </Box>
      <Box justifyContent="center">
        <Image key="picture" source={source} columns={columns} rows={rows} alt={`[图片 ${name} ${pic.width}×${pic.height}]`} />
      </Box>
    </Box>
  )
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
  // A picture has no lines: its tab shows it from the top. Clicked again, it
  // stays turned as the person left it.
  const isPicture = isPicturePath(ref.path)
  const now = await update($, memberOf(tabs, { requestId: id }), old => ({
    path: ref.path,
    ...(ref.line === undefined || isPicture ? {} : { line: ref.line }),
    seq: old.path === ref.path ? old.seq + 1 : 1,
    rev: old.rev,
    ...(old.path === ref.path && turnsOf(old) !== 0 ? { turns: turnsOf(old) } : {}),
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
    // Each hit as the longest of its readings that is a file, if any is.
    const hrefs = new Map<Hit, string>()
    await Promise.all(
      hits.map(async hit => {
        for (const reading of [...(hit.longer ?? []), hit]) {
          const abs = resolvePath(reading.path, cwd, homeDir)
          if (abs === undefined || !(await isFile($, abs))) continue
          hrefs.set({ ...hit, to: reading.to }, fileHref(abs, reading.line))
          return
        }
      }),
    )
    if (hrefs.size === 0) return next(e)
    const found = [...hrefs.keys()].sort((a, b) => a.from - b.from)
    const linked = linkify(e.props.text, found, hit => hrefs.get(hit))
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
    const where = `${shortPath(v.path, cwd, homeDir)}${v.line === undefined ? '' : `:${v.line}`}`
    if (isPicturePath(v.path)) return pictureTab($, e, v, where)
    const file = await load($, v.path)
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
