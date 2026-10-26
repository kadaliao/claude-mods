import type { ClientModule, ClientSurface } from 'claude-code'

import type { Comment } from '../types'

// The lanes the comments fly across, drawn on the surface itself: the hooks module
// hands over the comments as props, and this module moves them on its own frame
// clock, so the band above the prompt is not redrawn through the hooks ten times a
// second. Its pure parts are exported for the hooks module and the tests.

export const FRAME_MS = 100
// Every comment takes about this long to cross, so a long one moves faster.
export const CROSS_MS = 9000
// Cells kept clear behind the comment ahead in a lane.
const LANE_GAP = 4
const MAX_PENDING = 20
const NBSP = ' '

// --- cells ------------------------------------------------------------------------

// Wide East Asian letters and full-width punctuation, two terminal cells each.
const WIDE =
  /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/

export function charCells(ch: string): number {
  const cp = ch.codePointAt(0) ?? 0
  // Joiners, variation selectors and combining marks ride on the letter before.
  if (cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0x300 && cp <= 0x36f)) return 0
  if (cp >= 0x1f000) return 2
  return WIDE.test(ch) ? 2 : 1
}

export function cellsOf(s: string): number {
  let n = 0
  for (const ch of s) n += charCells(ch)
  return n
}

export function cutCells(s: string, room: number): string {
  let used = 0
  let out = ''
  for (const ch of s) {
    const w = charCells(ch)
    if (used + w > room) break
    used += w
    out += ch
  }
  return out
}

// --- the lanes ------------------------------------------------------------------------

// What the hooks module hands over: the latest comments, oldest first, by rising id.
export type Props = { comments: Comment[]; lanes: number }

// One comment on screen: where it is in cells and how far it moves each frame.
export type Flying = Comment & { width: number; lane: number; x: number; speed: number }
export type Lanes = { items: Flying[]; pending: Comment[]; seen: number }
export type Geo = { cols: number; lanes: number }
export type Run = { text: string; color?: string; isMine?: boolean }

export const emptyLanes: Lanes = { items: [], pending: [], seen: 0 }

// The first lane, from the top, where a comment of this speed starting at the right
// edge has room and never catches up with the one ahead before that one is gone.
export function freeLane(items: readonly Flying[], geo: Geo, speed: number): number | undefined {
  for (let lane = 0; lane < geo.lanes; lane++) {
    const isFree = items.every(a => {
      if (a.lane !== lane) return true
      const tail = a.x + a.width
      if (tail > geo.cols - LANE_GAP) return false
      return speed <= a.speed || geo.cols / speed >= tail / a.speed
    })
    if (isFree) return lane
  }
  return undefined
}

// Takes the comments not seen yet, then puts what waits into lanes with room.
export function place(s: Lanes, comments: readonly Comment[], geo: Geo): Lanes {
  const fresh = comments.filter(c => c.id > s.seen)
  const seen = fresh.reduce((m, c) => Math.max(m, c.id), s.seen)
  let items = s.items
  const left: Comment[] = []
  for (const c of [...s.pending, ...fresh]) {
    const width = cellsOf(c.text)
    const speed = (geo.cols + width) / (CROSS_MS / FRAME_MS)
    const lane = freeLane(items, geo, speed)
    if (lane === undefined) left.push(c)
    else items = [...items, { ...c, width, lane, x: geo.cols, speed }]
  }
  return { items, pending: left.slice(-MAX_PENDING), seen }
}

// One frame: every comment moves left and those gone past the left edge leave.
export function step(s: Lanes, comments: readonly Comment[], geo: Geo): Lanes {
  const items = s.items.map(it => ({ ...it, x: it.x - it.speed })).filter(it => it.x + it.width > 0)
  return place({ ...s, items }, comments, geo)
}

type Cell = { ch: string; color?: string; isMine?: boolean; isTail?: boolean }

// One lane as styled runs `cols` cells wide: each comment at its column, cut at both
// edges; half a wide letter at an edge is left blank.
export function layoutLane(items: readonly Flying[], cols: number): Run[] {
  const cells: Array<Cell | undefined> = new Array(Math.max(0, cols)).fill(undefined)
  for (const item of [...items].sort((a, b) => a.x - b.x)) {
    let p = Math.floor(item.x)
    let last = -1
    for (const ch of item.text) {
      const w = charCells(ch)
      if (w === 0) {
        const head = cells[last]
        if (last >= 0 && head !== undefined) head.ch += ch
        continue
      }
      if (p >= 0 && p + w <= cols) {
        // Writing over the second half of a wide letter blanks its first half.
        if (cells[p]?.isTail && p > 0) cells[p - 1] = undefined
        cells[p] = { ch, color: item.color, isMine: item.isMine }
        if (w === 2) cells[p + 1] = { ch: '', color: item.color, isMine: item.isMine, isTail: true }
        last = p
      }
      p += w
    }
  }

  const runs: Run[] = []
  for (const cell of cells) {
    const ch = cell === undefined ? NBSP : cell.ch
    const color = cell?.color
    const isMine = cell?.isMine
    const prev = runs[runs.length - 1]
    if (prev && prev.color === color && prev.isMine === isMine) prev.text += ch
    else {
      const run: Run = { text: ch }
      if (color !== undefined) run.color = color
      if (isMine !== undefined) run.isMine = isMine
      runs.push(run)
    }
  }
  // Blank runs at the end draw nothing.
  while (runs.length > 0) {
    const tail = runs[runs.length - 1]
    if (tail === undefined || tail.color !== undefined || tail.isMine !== undefined) break
    const trimmed = tail.text.replace(/ +$/, '')
    if (trimmed !== '') {
      tail.text = trimmed
      break
    }
    runs.pop()
  }
  return runs
}

// --- the surface module -------------------------------------------------------------

// Each instance's latest props, and its lanes as its frame clock last left them (a
// tick may come before the redraw it asked for).
type Live = { props: Props; state: Lanes }
const lives = new WeakMap<ClientSurface<Lanes>, Live>()

const geoOf = (props: Props, cols: number): Geo => ({ cols: Math.max(12, cols - 1), lanes: Math.max(1, props.lanes) })

function tick(surface: ClientSurface<Lanes>): void {
  const live = lives.get(surface)
  // Not laid out yet: a comment placed now would start mid-lane.
  if (live === undefined || surface.columns <= 0) return
  const cur = live.state
  // Nothing flying and nothing new: no redraw.
  const isNew = live.props.comments.some(c => c.id > cur.seen)
  if (cur.items.length === 0 && cur.pending.length === 0 && !isNew) return
  const next = step(cur, live.props.comments, geoOf(live.props, surface.columns))
  live.state = next
  surface.setState(next)
}

const Screen: ClientModule<Props, Lanes> = (props, surface) => {
  const { Box, Text } = surface.elements
  let live = lives.get(surface)
  if (live === undefined) {
    // This instance's first call (or this module's, after a reload): start its clock.
    live = { props, state: surface.state ?? emptyLanes }
    lives.set(surface, live)
    surface.every(FRAME_MS, () => tick(surface))
  }
  live.props = props
  const s = live.state
  const geo = geoOf(props, surface.columns)

  const rows = []
  for (let lane = 0; lane < geo.lanes; lane++) {
    const runs = layoutLane(
      s.items.filter(it => it.lane === lane),
      geo.cols,
    )
    rows.push(
      <Text wrap="truncate">
        {runs.length === 0
          ? NBSP
          : runs.map(run =>
              run.color !== undefined || run.isMine ? (
                <Text color={run.color} bold={run.isMine} underline={run.isMine}>
                  {run.text}
                </Text>
              ) : (
                run.text
              ),
            )}
      </Text>,
    )
  }
  return <Box flexDirection="column">{rows}</Box>
}

export default Screen
