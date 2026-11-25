// Finding file paths in a reply's markdown and turning them into file: links.
// Pure: whether a path is a file is the caller's to ask.

// One place in the text that may name a file.
export type Hit = {
  // Where it is in the text: [from, to).
  from: number
  to: number
  // The path as written, less its line suffix.
  path: string
  line?: number
  // plain: a run of path characters in prose; code: a whole inline code span;
  // link: a markdown link whose target is no URL (`[x](src/x.ts#L3)`).
  kind: 'plain' | 'code' | 'link'
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})\s*$/
// What a line holds that is not prose: an inline code span, a link or image,
// a reference link, an autolink or tag, a URL.
const SPECIAL = /(`+)([^`]+?)\1(?!`)|(!?)\[([^\]]*)\]\(([^)\s]*)\)|!?\[[^\]]*\]\[[^\]]*\]|<[^>\s]+>|[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s<>`]*/g
// The characters a path in prose is made of: no space, no CJK, so a path glued
// to Chinese text still stands alone.
const PATH_RUN = /[A-Za-z0-9_\-.~/@+]+/g
// `:12`, `:12:5`, `:12-20`, `#L12`, `#L12-L20`
const SUFFIX = /^(?::(\d+)(?::\d+|-\d+)?|#L(\d+)(?:-L?\d+)?)/
const WITH_SUFFIX = /^(.*?)(?::(\d+)(?::\d+|-\d+)?|#L(\d+)(?:-L?\d+)?)?$/
const NAME_WITH_EXT = /^[\w\-@+.]*[\w\-@+]\.[A-Za-z][A-Za-z0-9]{0,11}$/
const DOTFILE = /^\.[A-Za-z][\w\-.]*$/
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/
// The most places one reply is asked about.
const MOST_HITS = 120

// Whether a string could be a path at all: a slash in it, a name with an
// extension, or a dotfile. Whether it is a file is asked after.
export function isPathLike(s: string): boolean {
  if (s.length < 2 || s.length > 1024 || s.startsWith('//') || s.includes('://')) return false
  if (/[\n`<>|*?"]/.test(s)) return false
  if (s.includes('/')) return /[A-Za-z0-9]/.test(s) && !/\s{2}/.test(s)
  return NAME_WITH_EXT.test(s) || DOTFILE.test(s)
}

function lineOf(a: string | undefined, b: string | undefined): number | undefined {
  const n = Number(a ?? b)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

// The places in `text` that may name a file, in order; none inside a fenced
// code block, a URL, or a link to a URL.
export function findHits(text: string): Hit[] {
  const hits: Hit[] = []
  let offset = 0
  let fence: { ch: string; len: number } | undefined
  for (const line of text.split('\n')) {
    const at = offset
    offset += line.length + 1
    if (fence !== undefined) {
      const close = FENCE_CLOSE.exec(line)?.[1] ?? ''
      if (close[0] === fence.ch && close.length >= fence.len) fence = undefined
      continue
    }
    const open = FENCE_OPEN.exec(line)?.[1]
    if (open !== undefined) {
      fence = { ch: open.charAt(0), len: open.length }
      continue
    }
    scanLine(line, at, hits)
    if (hits.length >= MOST_HITS) break
  }
  return hits.slice(0, MOST_HITS)
}

function scanLine(line: string, at: number, hits: Hit[]): void {
  let prose = 0
  SPECIAL.lastIndex = 0
  for (let m = SPECIAL.exec(line); m !== null; m = SPECIAL.exec(line)) {
    scanProse(line.slice(prose, m.index), at + prose, hits)
    prose = m.index + m[0].length
    const from = at + m.index
    const to = at + prose
    if (m[1] !== undefined) {
      // An inline code span: the whole of it, trimmed, names the file or not.
      const inner = (m[2] ?? '').trim()
      const parts = WITH_SUFFIX.exec(inner)
      const path = parts?.[1] ?? inner
      if (isPathLike(path)) hits.push({ from, to, path, line: lineOf(parts?.[2], parts?.[3]), kind: 'code' })
    } else if (m[5] !== undefined && m[3] === '' && m[5] !== '' && !SCHEME.test(m[5])) {
      // A link to no URL: the target names the file.
      const target = safeDecode(m[5])
      const parts = WITH_SUFFIX.exec(target)
      const path = parts?.[1] ?? target
      if (path !== '' && !path.startsWith('#')) hits.push({ from, to, path, line: lineOf(parts?.[2], parts?.[3]), kind: 'link' })
    }
  }
  scanProse(line.slice(prose), at + prose, hits)
}

function scanProse(text: string, at: number, hits: Hit[]): void {
  PATH_RUN.lastIndex = 0
  for (let m = PATH_RUN.exec(text); m !== null; m = PATH_RUN.exec(text)) {
    const run = m[0]
    const path = run.replace(/\.+$/, '')
    if (!isPathLike(path)) continue
    const end = m.index + run.length
    // A suffix only where the run did not end on a full stop.
    const suffix = path.length === run.length ? SUFFIX.exec(text.slice(end)) : null
    const to = m.index + path.length + (suffix?.[0].length ?? 0)
    hits.push({ from: at + m.index, to: at + to, path, line: lineOf(suffix?.[1], suffix?.[2]), kind: 'plain' })
  }
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

// The absolute path a written one names, from the session's directory and
// the home directory; `.` and `..` folded.
export function resolvePath(path: string, cwd: string, home: string | undefined): string | undefined {
  let full: string
  if (path === '~' || path.startsWith('~/')) {
    if (home === undefined || home === '') return undefined
    full = home + path.slice(1)
  } else if (path.startsWith('/')) full = path
  else full = `${cwd}/${path}`
  const parts: string[] = []
  for (const part of full.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return `/${parts.join('/')}`
}

// The file: link the pane answers for a path and line.
export function fileHref(abs: string, line?: number): string {
  const path = encodeURI(abs).replace(/[#?()[\]]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  return `file://${path}${line === undefined ? '' : `#L${line}`}`
}

// The path and line a file: link names: one this module wrote, or one a
// surface handed back decoded.
export function parseHref(href: string): { path: string; line?: number } | undefined {
  if (!href.startsWith('file://')) return undefined
  const rest = href.slice('file://'.length).replace(/^localhost\//, '/')
  const hash = rest.lastIndexOf('#L')
  const pathPart = hash < 0 ? rest : rest.slice(0, hash)
  const line = hash < 0 ? undefined : lineOf(/^#L(\d+)/.exec(rest.slice(hash))?.[1], undefined)
  const path = safeDecode(pathPart)
  if (!path.startsWith('/')) return undefined
  return line === undefined ? { path } : { path, line }
}

// Escapes what markdown would read as emphasis in a path drawn as link text.
function escapeLabel(s: string): string {
  return s.replace(/([_*~\\[\]])/g, '\\$1')
}

// The text with each hit `hrefOf` answers drawn as a link to that href, and
// the hrefs written, for `pressableLinks`.
export function linkify(text: string, hits: readonly Hit[], hrefOf: (hit: Hit) => string | undefined): { text: string; hrefs: string[] } {
  let out = ''
  let at = 0
  const hrefs = new Set<string>()
  for (const hit of hits) {
    const href = hrefOf(hit)
    if (href === undefined || hit.from < at) continue
    const written = text.slice(hit.from, hit.to)
    out += text.slice(at, hit.from)
    if (hit.kind === 'link') out += `${written.slice(0, written.lastIndexOf(']('))}](${href})`
    else if (hit.kind === 'code') out += `[${written}](${href})`
    else out += `[${escapeLabel(written)}](${href})`
    at = hit.to
    hrefs.add(href)
  }
  return { text: out + text.slice(at), hrefs: [...hrefs] }
}
