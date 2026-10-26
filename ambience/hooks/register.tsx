import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Prefs, Report } from '../types'

// Sounds for what Claude does, a notification after a long turn, and a tally of
// the turn's work in the status line under the prompt:
//
//   ⚔ 本轮  ✎ 3 文件 +120 −30 · ⚡ 8 命令 1✗ · 📖 12 · ⏱ 1m05s
//   🏁 上轮  ✎ 3 文件 +120 −30 · ⚡ 8 命令 1✗ · 📖 12 · ⏱ 2m13s
//
// Only the main loop's calls make a sound; a subagent's are counted and kept quiet.

export type Sound = 'click' | 'pop' | 'chime' | 'fanfare' | 'fail' | 'commit'

const GAIN: Record<string, number> = { low: 0.3, normal: 0.6, high: 1.0 }
// The same sound plays at most once in this long (a click, once in a longer while), so
// a burst of edits pops once; different sounds may play over each other.
const MIN_GAP_MS = 120
const MIN_CLICK_GAP_MS = 300
const TICK_MS = 1000

export const TEST_COMMAND =
  /\b(pytest|jest|vitest|mocha|go test|cargo test|(npm|pnpm|yarn|bun) (run )?test|claude plugin test|make test)\b/
export const COMMIT_COMMAND = /\bgit\b[^|;&]*\bcommit\b/
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob'])
const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])

const report = atom({ plugin: 'ambience', key: 'report' } as const, null, { shape: 'report-1' })
const prefs = atom({ plugin: 'ambience', key: 'prefs' } as const, { isMuted: false, isReportOn: true }, {
  shape: 'prefs-1',
})

export const emptyReport = (startedAt: number): Report => ({
  startedAt,
  endedAt: null,
  files: [],
  added: 0,
  removed: 0,
  commands: 0,
  reads: 0,
  failed: 0,
})

// --- reading a tool's result ---------------------------------------------------

// Lines added and removed by an Edit or Write, from the result's patch; a new file
// written whole has no patch, so its lines count as added.
export function countLines(result: unknown): { added: number; removed: number } {
  const r = (result ?? {}) as {
    structuredPatch?: Array<{ lines?: string[] }>
    type?: string
    content?: string
    originalFile?: string | null
  }
  let added = 0
  let removed = 0
  for (const hunk of r.structuredPatch ?? []) {
    for (const line of hunk.lines ?? []) {
      if (line.startsWith('+')) added += 1
      else if (line.startsWith('-')) removed += 1
    }
  }
  if (added === 0 && removed === 0 && r.type === 'create' && typeof r.content === 'string') {
    added = r.content === '' ? 0 : r.content.replace(/\n$/, '').split('\n').length
  }
  return { added, removed }
}

const filePathOf = (input: unknown): string | undefined => {
  const i = input as { file_path?: unknown; notebook_path?: unknown }
  const path = i.file_path ?? i.notebook_path
  return typeof path === 'string' ? path : undefined
}

// --- the status line -----------------------------------------------------------

export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

// The tally without its lead: what the status line and the notification share.
export function summarize(r: Report, now: number): string {
  const parts: string[] = []
  if (r.files.length > 0) parts.push(`✎ ${r.files.length} 文件 +${r.added} −${r.removed}`)
  if (r.commands > 0) parts.push(`⚡ ${r.commands} 命令${r.failed > 0 ? ` ${r.failed}✗` : ''}`)
  else if (r.failed > 0) parts.push(`${r.failed}✗`)
  if (r.reads > 0) parts.push(`📖 ${r.reads}`)
  parts.push(`⏱ ${fmtDuration((r.endedAt ?? now) - r.startedAt)}`)
  return parts.join(' · ')
}

export function formatReport(r: Report, now: number): string {
  return `${r.endedAt === null ? '⚔ 本轮' : '🏁 上轮'}  ${summarize(r, now)}`
}

// --- sounds and the status line -------------------------------------------------

// Set by `register` from the options; module variables, so a reload starts them over.
let gain = GAIN.normal
let notifyAfterMs = 60_000
let ticker: Timer | undefined
const lastPlayedAt = new Map<Sound, number>()

async function play($: EngineInterface, sound: Sound): Promise<void> {
  if ((await read($, prefs)).isMuted) return
  const now = await $.clock.now()
  const gap = sound === 'click' ? MIN_CLICK_GAP_MS : MIN_GAP_MS
  if (now - (lastPlayedAt.get(sound) ?? -Infinity) < gap) return
  lastPlayedAt.set(sound, now)
  await $.audio.play({ asset: `sounds/${sound}.wav` }, { gain })
}

function playSoon($: EngineInterface, sound: Sound): void {
  void play($, sound).catch(() => {})
}

async function showStatus($: EngineInterface): Promise<void> {
  const [r, p] = await Promise.all([read($, report), read($, prefs)])
  $.ui.status(p.isReportOn && r !== null ? formatReport(r, await $.clock.now()) : undefined)
}

function showSoon($: EngineInterface): void {
  void showStatus($).catch(() => {})
}

async function tally($: EngineInterface, fn: (r: Report) => Report): Promise<void> {
  const now = await $.clock.now()
  await update($, report, r => fn(r ?? emptyReport(now)))
  showSoon($)
}

function startTicker($: EngineInterface): void {
  ticker?.cancel()
  ticker = $.clock.every(TICK_MS, () => showSoon($))
}

function stopTicker(): void {
  ticker?.cancel()
  ticker = undefined
}

// --- hooks ----------------------------------------------------------------------

export const register: Register = (on, options) => {
  gain = GAIN[String(options.volume)] ?? GAIN.normal
  notifyAfterMs = options.notifyAfter === 'off' ? Infinity : (Number(options.notifyAfter) || 60) * 1000

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'ambience',
      description: 'Sounds and the turn tally: mute, unmute, report on|off, demo',
      argumentHint: '[mute|unmute|report on|report off|demo]',
    })
    const saved = (await $.store.get('prefs')) as Partial<Prefs> | undefined
    if (saved !== undefined) await update($, prefs, p => ({ ...p, ...saved }))
    showSoon($)
    return started
  })

  on('command.run', { command: 'ambience' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase().replace(/\s+/g, ' ')
    if (arg === 'demo') {
      for (const sound of ['click', 'pop', 'commit', 'fanfare', 'fail', 'chime'] as const) {
        await $.audio.play({ asset: `sounds/${sound}.wav` }, { gain }).catch(() => {})
        await $.clock.sleep(250)
      }
      return { text: 'ambience: click · pop · commit · fanfare · fail · chime' }
    }
    const change: Partial<Prefs> =
      arg === 'mute' || arg === 'sound off'
        ? { isMuted: true }
        : arg === 'unmute' || arg === 'sound on'
          ? { isMuted: false }
          : arg === 'report on'
            ? { isReportOn: true }
            : arg === 'report off'
              ? { isReportOn: false }
              : {}
    const now = (await update($, prefs, p => ({ ...p, ...change }))) ?? (await read($, prefs))
    await $.store.set('prefs', now)
    showSoon($)
    const isKnown = arg === '' || Object.keys(change).length > 0
    return {
      text:
        `${isKnown ? '' : `ambience: unknown "${arg}". `}` +
        `sounds ${now.isMuted ? 'muted' : 'on'} (volume ${String(options.volume ?? 'normal')}), ` +
        `turn tally ${now.isReportOn ? 'on' : 'off'}, ` +
        `notification ${Number.isFinite(notifyAfterMs) ? `after ${notifyAfterMs / 1000}s` : 'off'}. ` +
        'Try /ambience demo.',
    }
  })

  // Each turn of the main loop starts a new tally.
  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const now = await $.clock.now()
    await update($, report, () => emptyReport(now))
    startTicker($)
    showSoon($)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const isMain = e.agentId === undefined
    const tool = String(e.tool)
    const command = e.tool === 'Bash' ? e.command : ''
    if (isMain && tool === 'Bash') playSoon($, 'click')

    const ran = await next(e)
    if (ran.deny !== undefined) return ran
    const isError = ran.isError === true

    void tally($, r => {
      const t = { ...r }
      if (isError) t.failed += 1
      if (tool === 'Bash') t.commands += 1
      else if (READ_TOOLS.has(tool)) t.reads += 1
      else if (EDIT_TOOLS.has(tool) && !isError) {
        const path = filePathOf(e)
        if (path !== undefined && !t.files.includes(path)) t.files = [...t.files, path]
        const { added, removed } = countLines(ran.result)
        t.added += added
        t.removed += removed
      }
      return t
    }).catch(() => {})

    if (isMain) {
      if (tool === 'Bash' && TEST_COMMAND.test(command)) playSoon($, isError ? 'fail' : 'fanfare')
      else if (tool === 'Bash' && COMMIT_COMMAND.test(command) && !isError) playSoon($, 'commit')
      else if (EDIT_TOOLS.has(tool)) playSoon($, isError ? 'fail' : 'pop')
      // A Bash command that exits non-zero (a grep with no match) is too common to sound.
      else if (isError && tool !== 'Bash') playSoon($, 'fail')
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined) return done
    stopTicker()

    const now = await $.clock.now()
    const ended = await update($, report, r => ({ ...(r ?? emptyReport(now - e.durationMs)), endedAt: now }))
    showSoon($)

    if (e.reason === 'answer') {
      playSoon($, 'chime')
      if (e.durationMs >= notifyAfterMs && ended !== null) {
        const gist = e.answer.replace(/\s+/g, ' ').trim().slice(0, 60)
        void $.ui
          .notify(`${summarize(ended, now)}${gist ? `\n${gist}` : ''}`, { title: 'Claude 干完了' })
          .catch(() => {})
      }
    } else if (e.reason === 'error' || e.reason === 'refusal') {
      playSoon($, 'fail')
    }
    return done
  })
}
