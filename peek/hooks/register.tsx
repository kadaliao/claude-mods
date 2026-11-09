import { atom, memberOf, read, update } from 'claude-code'
import type { Elements, EngineInterface, ImageSource, Register, RenderElement, RenderNode, RenderViewport } from 'claude-code'

import type { Probe, Shot } from '../types'
import { noteCalls, pastedOf, picturesOf, promptKey } from './collect'
import type { Found, ToolUse } from './collect'
import { draw, fit, forget, forgetAll } from './picture'

// How many pictures' bytes the session keeps; an older row says it let go.
const KEEP = 100
// The most thumbnails a folded "Read N files" line shows under it.
const GROUP_THUMBS = 12
// Where the transcript's result text starts under a tool row ("  ⎿  ").
const INDENT = 5
// Where a prompt's text starts in its row ("❯ ").
const PROMPT_INDENT = 2

// A family: one member per tool call, by its tool_use_id.
const shots = atom({ plugin: 'peek', key: 'shots' } as const, [])
const probeState = atom({ plugin: 'peek', key: 'probe' } as const, { canDraw: 'unknown' }, { shape: 'probe-1' })
// The verbose setting: every row then says it is expanded, as under ctrl+o.
const verboseState = atom({ plugin: 'peek', key: 'verbose' } as const, false)

type Terminal = Elements['terminal']
type Shown = Shot & { data?: string }

// Bytes by picture id, oldest first. Kept in the module, not in state: a
// reload reads them back from the conversation.
const bytes = new Map<string, string>()
// The session's tool calls by tool_use_id, to label what they return.
const calls = new Map<string, ToolUse>()
// The last picture drawn as an Image while it is unknown whether the terminal
// draws pictures: what the probe asks the terminal with.
let lastShot: { requestId: string; key: string; source: ImageSource } | undefined
let isProbing = false

function keep(id: string, data: string): void {
  bytes.delete(id)
  bytes.set(id, data)
  for (const old of bytes.keys()) {
    if (bytes.size <= KEEP) break
    bytes.delete(old)
    forget(old)
  }
}

// Files what a row brought under the calls that returned it.
async function add($: EngineInterface, found: Found[]): Promise<void> {
  const byCall = new Map<string, Shot[]>()
  for (const f of found) {
    keep(f.shot.id, f.data)
    byCall.set(f.callId, [...(byCall.get(f.callId) ?? []), f.shot])
  }
  for (const [callId, list] of byCall) await update($, memberOf(shots, { requestId: callId }), () => list)
}

// Reads the pictures back from the conversation: on a resume, and after a
// reload, which keeps the rows' lists but not the bytes.
async function rebuild($: EngineInterface): Promise<void> {
  const messages = await $.session.messages({ as: 'api' })
  if (!Array.isArray(messages)) return
  const found: Found[] = []
  for (const m of messages) {
    if (m.role === 'assistant') noteCalls(m.content, calls)
    else found.push(...picturesOf(m.content, calls), ...pastedOf(m.content))
  }
  await add($, found.slice(-KEEP))
}

async function readVerbose($: EngineInterface): Promise<void> {
  const row = (await $.config.list()).find(r => r.key === 'verbose')
  await update($, verboseState, () => row?.value === true)
}

// What to tell the person when Claude Code drew a picture's alt in its place,
// from the reason it gave: the terminal it saw, and how to get pictures there.
// Claude Code turns pictures on only for terminals it recognises (kitty,
// Ghostty, iTerm2 in fullscreen); one that draws them but goes unrecognised
// (herdr, say) needs the variable set before Claude Code starts.
export function hintFor(deny: string): { terminal: string; text: string } | undefined {
  const reason = deny.replace(/^the Image draws its alt here: /, '')
  if (/^images inside tmux/.test(reason)) return { terminal: 'tmux', text: `图片没显示：${reason}` }
  if (!/neither kitty placeholder images/.test(reason)) return undefined
  const named = /(?:terminal=|, terminal )([^,)]+)/.exec(reason)?.[1]?.trim()
  const terminal = named === undefined || named === '' || named === 'unknown' ? '这个终端' : named
  if (/^iterm/i.test(terminal)) return { terminal, text: 'iTerm2 要在全屏模式下才能显示图片：输入 /tui fullscreen' }
  return {
    terminal,
    text: `图片没显示（终端：${terminal}）。如果它支持 kitty 图片协议，在 ~/.claude/settings.json 的 env 里加上 "CLAUDE_CODE_FORCE_TERMINAL_IMAGES": "1"，重启 Claude Code`,
  }
}

// Asks the terminal, through a blit of the last Image drawn, whether it draws
// pictures; the answer stands for the session.
async function probe($: EngineInterface): Promise<void> {
  if (isProbing || lastShot === undefined) return
  if ((await read($, probeState)).canDraw !== 'unknown') return
  isProbing = true
  try {
    const shot = lastShot
    const r = await $.ui.blit({ requestId: shot.requestId, key: shot.key, source: shot.source })
    if (r.deny === undefined) {
      await update($, probeState, (): Probe => ({ canDraw: 'yes' }))
    } else if (/draws its alt/.test(r.deny)) {
      // Said once per terminal, ever: the person learns it, and is not told again.
      const hint = hintFor(r.deny)
      const told = await $.store.get('told')
      const toldList = Array.isArray(told) ? told.filter(t => typeof t === 'string') : []
      if (hint !== undefined && !toldList.includes(hint.terminal)) {
        await $.store.set('told', [...toldList, hint.terminal])
        await update($, probeState, (): Probe => ({ canDraw: 'no', hintAt: shot.requestId, hint: hint.text }))
      } else {
        await update($, probeState, (): Probe => ({ canDraw: 'no' }))
      }
    }
    // Anything else (no longer mounted, resized) is asked again on a later tick.
  } finally {
    isProbing = false
  }
}

type ReadOutput = {
  type?: string
  file?: {
    base64?: string
    type?: string
    dimensions?: { displayWidth?: number; displayHeight?: number; originalWidth?: number; originalHeight?: number }
  }
}

// The pictures a tool row shows: what the session collected for the call, or,
// for a Read, its own result.
async function shownFor($: EngineInterface, callId: string | undefined, tool: string, output: unknown): Promise<Shown[]> {
  if (callId === undefined) return []
  const list = await read($, memberOf(shots, { requestId: callId }))
  if (list.length > 0) return list.map(s => ({ ...s, data: bytes.get(s.id) }))
  const out = output as ReadOutput | undefined
  if (tool !== 'Read' || out?.type !== 'image' || typeof out.file?.base64 !== 'string') return []
  const d = out.file.dimensions
  return [
    {
      id: `call-${callId}`,
      mime: out.file.type ?? 'image/png',
      data: out.file.base64,
      width: d?.displayWidth ?? d?.originalWidth ?? 0,
      height: d?.displayHeight ?? d?.originalHeight ?? 0,
      label: '',
    },
  ]
}

// The pictures pasted into a prompt: filed under its row's id, or, on a
// resumed session, under its text.
async function pastedFor($: EngineInterface, requestId: string, text: string): Promise<Shown[]> {
  for (const key of [requestId, promptKey(text)]) {
    if (key === undefined) continue
    const list = await read($, memberOf(shots, { requestId: key }))
    if (list.length > 0) return list.map(s => ({ ...s, data: bytes.get(s.id) }))
  }
  return []
}

// The box each picture may take: one picture, or each of several side by side.
function boxOf(room: number, count: number, isBig: boolean, isLarge: boolean): { maxCols: number; maxRows: number } {
  if (isBig) return { maxCols: room, maxRows: 30 }
  if (count > 1) return isLarge ? { maxCols: 28, maxRows: 6 } : { maxCols: 20, maxRows: 4 }
  return isLarge ? { maxCols: room, maxRows: 16 } : { maxCols: Math.min(room, 36), maxRows: 5 }
}

// One picture in a box of at most `maxCols` × `maxRows` cells.
function pictureOf(els: Terminal, requestId: string, s: Shown, p: Probe, maxCols: number, maxRows: number): RenderNode {
  const { Text, Image } = els
  if (s.data === undefined) return <Text dimColor>（这张图太早，已经不在内存里了）</Text>
  const { columns, rows } = fit(s.width, s.height, maxCols, maxRows)
  const d = draw(s.id, s.mime, s.data, columns, rows)
  if (d.kind === 'none') return <Text dimColor>（{d.reason}）</Text>
  const key = `img-${s.id}`
  if (p.canDraw === 'unknown') lastShot = { requestId, key, source: d.source }
  const size = s.width > 0 && s.height > 0 ? ` ${s.width}×${s.height}` : ''
  return <Image key={key} source={d.source} columns={d.columns} rows={d.rows} alt={`[图片${s.label ? ` ${s.label}` : ''}${size}]`} />
}

// Under the one row the probe drew with, the first time on this terminal: how
// to get the pictures drawn.
function hintOf(els: Terminal, requestId: string, p: Probe, indent = INDENT): RenderNode | false {
  if (p.canDraw !== 'no' || p.hintAt !== requestId || p.hint === undefined) return false
  const { Box, Text } = els
  return (
    <Box paddingLeft={indent}>
      <Text dimColor>{p.hint}</Text>
    </Box>
  )
}

// A row with its pictures under it, `indent` cells in. Large only under the
// ctrl+o transcript: with verbose on every row says it is expanded, so the
// pictures keep the size the person chose.
async function under(
  $: EngineInterface,
  e: { requestId: string; viewport?: RenderViewport },
  els: Terminal,
  row: RenderElement,
  shown: Shown[],
  indent: number,
  isExpanded: boolean | undefined,
  isLarge: boolean,
): Promise<RenderElement> {
  const p = await read($, probeState)
  const hint = hintOf(els, e.requestId, p, indent)
  if (p.canDraw === 'no' && hint === false) return row
  const isBig = isExpanded === true && !(await read($, verboseState))
  const room = Math.max(20, (e.viewport?.columns ?? 80) - indent - 1)
  const { maxCols, maxRows } = boxOf(room, shown.length, isBig, isLarge)
  const { Box } = els
  return (
    <Box flexDirection="column">
      {row}
      {p.canDraw !== 'no' && (
        <Box paddingLeft={indent} flexWrap="wrap" columnGap={1}>
          {shown.map(s => pictureOf(els, e.requestId, s, p, maxCols, maxRows))}
        </Box>
      )}
      {hint}
    </Box>
  )
}

export const register: Register = (on, options) => {
  const isLarge = options.size === 'large'

  on('session.start', async ($, e, next) => {
    // Asks the terminal whether it draws pictures, once there is one to ask with.
    const timer = $.clock.every(1000, () => {
      void probe($)
        .then(async () => {
          if ((await read($, probeState)).canDraw !== 'unknown') timer.cancel()
        })
        .catch(() => {})
    })
    $.clock.after(0, () => void rebuild($).catch(() => {}))
    $.clock.after(0, () => void readVerbose($).catch(() => {}))
    return next(e)
  })

  on('config.set', { key: 'verbose' }, async ($, e, next) => {
    const r = await next(e)
    if (r.deny === undefined) await update($, verboseState, () => r.value === true).catch(() => {})
    return r
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      bytes.clear()
      calls.clear()
      forgetAll()
    }
    return next(e)
  })

  // Collects each row's pictures before the row is kept, so it draws with them.
  on('session.append', async ($, e, next) => {
    try {
      const m = e.message
      if (m.role === 'assistant') noteCalls(m.content, calls)
      else if (m.role === 'user' && e.door === 'tool-result') {
        await add($, picturesOf(m.content, calls, e.origin.kind === 'tool' ? e.origin.tool : undefined))
      } else if (m.role === 'user') await add($, pastedOf(m.content, e.uuid))
    } catch {
      // A picture that cannot be read is left out; the row is kept regardless.
    }
    return next(e)
  })

  // The pictures under each tool row that returned some; ctrl+o draws them large.
  // Where the terminal draws no pictures the row is left as it is.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.isRunning || e.props.isErrored) return next(e)
    const shown = await shownFor($, e.props.tool_use_id, e.props.tool, e.props.output)
    if (shown.length === 0) return next(e)
    return under($, e, $.ui.resolve(e), await next(e), shown, INDENT, e.props.isExpanded, isLarge)
  })

  // The pictures pasted into a prompt, under its row.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const shown = await pastedFor($, e.requestId, e.props.text)
    if (shown.length === 0) return next(e)
    return under($, e, $.ui.resolve(e), await next(e), shown, PROMPT_INDENT, e.props.isExpanded, isLarge)
  })

  // Thumbnails under a folded "Read N files" line, for the calls that read pictures.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.isExpanded) return next(e)
    const shown: Shown[] = []
    for (const c of e.props.calls) {
      if (c.isRunning || c.isErrored) continue
      shown.push(...(await shownFor($, c.tool_use_id, c.tool, c.output)))
    }
    if (shown.length === 0) return next(e)
    const p = await read($, probeState)
    const els = $.ui.resolve(e)
    const hint = hintOf(els, e.requestId, p)
    if (p.canDraw === 'no' && hint === false) return next(e)
    const { Box, Text } = els
    const room = Math.max(20, (e.viewport?.columns ?? 80) - INDENT - 1)
    const { maxCols, maxRows } = boxOf(room, shown.length, false, isLarge)
    const thumbs = shown.slice(-GROUP_THUMBS)
    const row = await next(e)
    return (
      <Box flexDirection="column">
        {row}
        {p.canDraw !== 'no' && (
          <Box paddingLeft={INDENT} flexWrap="wrap" columnGap={1}>
            {thumbs.map(s => pictureOf(els, e.requestId, s, p, maxCols, maxRows))}
          </Box>
        )}
        {p.canDraw !== 'no' && shown.length > thumbs.length && (
          <Box paddingLeft={INDENT}>
            <Text dimColor>还有 {shown.length - thumbs.length} 张，ctrl+o 展开查看</Text>
          </Box>
        )}
        {hint}
      </Box>
    )
  })
}
