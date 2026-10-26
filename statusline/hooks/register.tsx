import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, TurnStepInput, TurnUsage } from 'claude-code'

import type { Git, Meter, Speed } from '../types'

// A two-row status band above the prompt:
//
//   ✦ Opus 5.5 high   claude-mods ⎇ main ●2 ⇡1   ctx ▰▰▰▱▱▱▱▱▱▱ 31% 62k/200k
//   ↑ 1.2M in  ↓ 35k out   cache 92%   $1.23   121 tok/s avg 129   TTFT 1.1s
//
// Tokens add up every model request of the session, subagents' included, so
// they go with the cost; tok/s and TTFT time the main loop's requests alone.

// A step that generates only a few tokens arrives in one burst, so its rate
// is noise: it counts toward the average but leaves the shown rate alone.
const MIN_TOKENS = 50
const MIN_DECODE_MS = 250
const REFRESH_MS = 10_000
const KEEP_SESSIONS = 50
const BAR_CELLS = 10
const GIT_TOOLS = new Set(['Bash', 'Edit', 'Write', 'NotebookEdit'])

const meter = atom({ plugin: 'statusline', key: 'meter' } as const, null)
const git = atom({ plugin: 'statusline', key: 'git' } as const, null)

type Timing = { ttftMs: number; decodeMs: number }

const emptyMeter = (sessionId: string): Meter => ({
  sessionId,
  tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  speed: { ttftMs: null, tps: null, steps: 0, outputTokens: 0, decodeMs: 0, ttftTotalMs: 0 },
  model: null,
  effort: null,
})

const round1 = (n: number) => Math.round(n * 10) / 10
const storeKey = (sessionId: string) => `meter:${sessionId}`

// --- the session's totals ---------------------------------------------------

// $.state survives a hot reload; $.store carries the totals to a resumed session.
async function ensureMeter($: EngineInterface): Promise<string> {
  const id = await $.session.id()
  if ((await read($, meter))?.sessionId === id) return id
  const saved = (await $.store.get(storeKey(id))) as Meter | undefined
  const loaded = saved?.sessionId === id ? saved : emptyMeter(id)
  await update($, meter, m => (m?.sessionId === id ? m : loaded))
  return id
}

function add(m: Meter, e: TurnStepInput, usage: TurnUsage, timing: Timing | undefined): Meter {
  const tokens = {
    input: m.tokens.input + usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens,
    output: m.tokens.output + usage.output_tokens,
    cacheRead: m.tokens.cacheRead + usage.cache_read_input_tokens,
    cacheWrite: m.tokens.cacheWrite + usage.cache_creation_input_tokens,
  }
  if (timing === undefined) return { ...m, tokens }

  const { ttftMs, decodeMs } = timing
  const out = usage.output_tokens
  const isMeasurable = out >= MIN_TOKENS && decodeMs >= MIN_DECODE_MS
  const speed: Speed = {
    ttftMs: Math.round(ttftMs),
    tps: isMeasurable ? round1((out / decodeMs) * 1000) : m.speed.tps,
    steps: m.speed.steps + 1,
    outputTokens: m.speed.outputTokens + out,
    decodeMs: Math.round(m.speed.decodeMs + decodeMs),
    ttftTotalMs: Math.round(m.speed.ttftTotalMs + ttftMs),
  }
  const effort = e.effort === undefined ? null : String(e.effort)
  return { ...m, tokens, speed, model: usage.model || e.model, effort }
}

async function record($: EngineInterface, e: TurnStepInput, usage: TurnUsage, timing?: Timing): Promise<void> {
  const id = await ensureMeter($)
  const saved = await update($, meter, m => add(m?.sessionId === id ? m : emptyMeter(id), e, usage, timing))
  if (saved !== null) await $.store.set(storeKey(id), saved)
}

async function pruneStore($: EngineInterface): Promise<void> {
  const keys = (await $.store.keys()).filter(k => k.startsWith('meter:'))
  for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_SESSIONS))) await $.store.delete(k)
}

// --- git ------------------------------------------------------------------------

export function parseGit(stdout: string): Git {
  let head = ''
  let oid = ''
  let ahead = 0
  let behind = 0
  let changed = 0
  for (const line of stdout.split('\n')) {
    if (line.startsWith('# branch.head ')) head = line.slice('# branch.head '.length)
    else if (line.startsWith('# branch.oid ')) oid = line.slice('# branch.oid '.length)
    else if (line.startsWith('# branch.ab ')) {
      const ab = /\+(\d+) -(\d+)/.exec(line)
      ahead = Number(ab?.[1] ?? 0)
      behind = Number(ab?.[2] ?? 0)
    } else if (line !== '' && !line.startsWith('#')) changed += 1
  }
  const branch = head === '(detached)' ? oid.slice(0, 7) : head
  return { branch, ahead, behind, changed }
}

let isGitBusy = false

async function refreshGit($: EngineInterface): Promise<void> {
  if (isGitBusy) return
  isGitBusy = true
  try {
    const run = await $.process.run(['git', '--no-optional-locks', 'status', '--porcelain=2', '--branch'], {
      timeoutMs: 3000,
    })
    const found = run.exitCode === 0 ? parseGit(run.stdout) : null
    if (JSON.stringify(await read($, git)) !== JSON.stringify(found)) await update($, git, () => found)
  } catch {
    // git missing or too slow: keep what is shown
  } finally {
    isGitBusy = false
  }
}

function redraw($: EngineInterface): void {
  try {
    $.ui.invalidate('ui.render')
  } catch {
    // nothing drawn to redraw
  }
}

// --- formatting -----------------------------------------------------------------

export function fmtTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 10_000) return `${round1(n / 1000)}k`
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  if (n < 10_000_000) return `${Math.round(n / 10_000) / 100}M`
  return `${round1(n / 1_000_000)}M`
}

export function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${round1(ms / 1000)}s`
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`
}

const ALIAS = /^(opus|sonnet|haiku|fable|default|best)$/i
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()

export function prettyModel(id: string): string {
  const bare = id.replace(/\[[^\]]*\]$/, '')
  const named = /claude-(opus|sonnet|haiku|fable)-(\d+)(?:[-.](\d{1,2}))?(?!\d)/i.exec(bare)
  if (named?.[1] && named[2]) return `${cap(named[1])} ${named[2]}${named[3] ? `.${named[3]}` : ''}`
  const older = /claude-(\d+)(?:-(\d))?-(opus|sonnet|haiku)/i.exec(bare)
  if (older?.[1] && older[3]) return `${cap(older[3])} ${older[1]}${older[2] ? `.${older[2]}` : ''}`
  return ALIAS.test(bare) ? cap(bare) : bare
}

// The session's model may be an alias ("opus"); the last request names the
// model it resolved to, unless the person has since switched to another family.
export function modelName(session: string, lastStep: string | null): string {
  if (lastStep === null || /claude-/i.test(session)) return prettyModel(session)
  const family = /(opus|sonnet|haiku|fable)/i.exec(session)?.[1]
  if (family && !lastStep.toLowerCase().includes(family.toLowerCase())) return prettyModel(session)
  return prettyModel(lastStep)
}

const basename = (path: string) => path.replace(/\/+$/, '').split('/').pop() || path

const level = (pct: number, warn: number, bad: number) => (pct >= bad ? 'error' : pct >= warn ? 'warning' : 'success')

// --- hooks ----------------------------------------------------------------------

export const register: Register = on => {
  let ticker: { cancel: () => void } | undefined

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await ensureMeter($).catch(() => {})
    void pruneStore($).catch(() => {})
    void refreshGit($)
    ticker?.cancel()
    ticker = $.clock.every(REFRESH_MS, () => {
      void refreshGit($)
      redraw($)
    })
    return started
  })

  on('prompt.submit', ($, e, next) => {
    void refreshGit($)
    return next(e)
  })

  on('command.run', async ($, e, next) => {
    // /model, /clear, /compact and the rest change what the band shows.
    const ran = await next(e)
    redraw($)
    return ran
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (GIT_TOOLS.has(e.tool)) void refreshGit($)
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    void refreshGit($)
    redraw($)
    return done
  })

  on('turn.step', async function* ($, e, next) {
    const isMain = e.agentId === undefined
    const sentAt = performance.now()
    const stream = next(e)
    let firstAt: number | undefined
    for await (const chunk of stream) {
      const now = performance.now()
      firstAt ??= now
      if (chunk.kind === 'stop' && chunk.usage) {
        const timing = isMain ? { ttftMs: firstAt - sentAt, decodeMs: now - firstAt } : undefined
        await record($, e, chunk.usage, timing).catch(() => {})
      }
      yield chunk
    }
    const result = await stream.result
    // The engine has priced the request by now: cost and context moved.
    redraw($)
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // What the mods beneath draw (danmaku's lanes, say) stays, above the two rows.
    const below = await next(e)
    if (e.props.hasSurvey) return below
    const { Box, Text } = $.ui.resolve(e)

    const [id, saved, repo, usage, sessionModel, cwd] = await Promise.all([
      $.session.id(),
      read($, meter),
      read($, git),
      $.session.usage(),
      $.session.model(),
      $.session.cwd(),
    ])
    const m = saved?.sessionId === id ? saved : emptyMeter(id)
    const { tokens, speed } = m
    const none = <Text dimColor>–</Text>

    const ctxPct = usage.context.percent
    const filled = ctxPct === undefined ? 0 : Math.min(BAR_CELLS, Math.round((ctxPct / 100) * BAR_CELLS))
    const ctxColor = level(ctxPct ?? 0, 50, 80)

    const cachePct = tokens.input > 0 ? Math.round((tokens.cacheRead / tokens.input) * 100) : undefined
    const cacheColor = cachePct === undefined ? 'subtle' : cachePct >= 70 ? 'success' : cachePct >= 40 ? 'warning' : 'error'

    const avgTps = speed.decodeMs > 0 ? Math.round((speed.outputTokens / speed.decodeMs) * 1000) : undefined
    const ttftColor = speed.ttftMs === null ? 'subtle' : level(speed.ttftMs, 2000, 5000)
    const cost = usage.cost?.usd

    return (
      <Box flexDirection="column">
        {below}
        <Box flexWrap="wrap" columnGap={3}>
          <Text>
            <Text color="claude" bold>
              ✦ {modelName(sessionModel, m.model)}
            </Text>
            {m.effort !== null && <Text dimColor> {m.effort}</Text>}
          </Text>
          <Text>
            <Text color="ide" bold>
              {basename(cwd)}
            </Text>
            {repo !== null && (
              <Text>
                <Text color="merged"> ⎇ {repo.branch}</Text>
                {repo.changed > 0 && <Text color="warning"> ●{repo.changed}</Text>}
                {repo.ahead > 0 && <Text color="suggestion"> ⇡{repo.ahead}</Text>}
                {repo.behind > 0 && <Text color="suggestion"> ⇣{repo.behind}</Text>}
              </Text>
            )}
          </Text>
          <Text>
            <Text dimColor>ctx </Text>
            <Text color={ctxColor}>{'▰'.repeat(filled)}</Text>
            <Text dimColor>{'▱'.repeat(BAR_CELLS - filled)}</Text>
            {ctxPct === undefined ? (
              <Text dimColor> {fmtTokens(usage.context.window)}</Text>
            ) : (
              <Text>
                <Text color={ctxColor} bold>
                  {' '}
                  {ctxPct}%
                </Text>
                <Text dimColor>
                  {' '}
                  {fmtTokens(usage.context.tokens ?? 0)}/{fmtTokens(usage.context.window)}
                </Text>
              </Text>
            )}
          </Text>
        </Box>
        <Box flexWrap="wrap" columnGap={3}>
          <Text>
            <Text color="ide">↑ </Text>
            {fmtTokens(tokens.input)}
            <Text dimColor> in </Text>
            <Text color="merged"> ↓ </Text>
            {fmtTokens(tokens.output)}
            <Text dimColor> out</Text>
          </Text>
          <Text>
            <Text dimColor>cache </Text>
            {cachePct === undefined ? none : <Text color={cacheColor}>{cachePct}%</Text>}
          </Text>
          {cost === undefined ? (
            none
          ) : (
            <Text color="warning" bold>
              ${cost.toFixed(2)}
            </Text>
          )}
          <Text>
            {speed.tps === null ? none : <Text color="suggestion" bold>{Math.round(speed.tps)}</Text>}
            <Text dimColor> tok/s</Text>
            {avgTps !== undefined && <Text dimColor> avg {avgTps}</Text>}
          </Text>
          <Text>
            <Text dimColor>TTFT </Text>
            {speed.ttftMs === null ? none : <Text color={ttftColor}>{fmtMs(speed.ttftMs)}</Text>}
          </Text>
        </Box>
      </Box>
    )
  })
}
