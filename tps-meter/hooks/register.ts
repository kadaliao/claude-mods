import type { EngineInterface, Register } from 'claude-code'

// Times every main-loop model request and writes the figures to
// <config dir>/tps/<session id>.json, which statusline-command.sh reads.
//
//   ttft_ms  request sent -> first stream event (network + queue + prefill)
//   tps      output_tokens / (stop - first event); thinking tokens count too
//
// A step that generates only a few tokens arrives in one burst, so its rate
// is noise: `tps` is null for it and `last_tps` keeps the latest usable one.

const MIN_TOKENS = 50
const MIN_DECODE_MS = 250

type Totals = { steps: number; outputTokens: number; decodeMs: number; ttftMs: number }

type Snapshot = {
  model: string
  updated_at: number
  ttft_ms: number
  output_tokens: number
  decode_ms: number
  tps: number | null
  last_tps: number | null
  avg_tps: number | null
  avg_ttft_ms: number
  steps: number
  session_output_tokens: number
  session_decode_ms: number
  session_ttft_ms: number
}

const emptyTotals = (): Totals => ({ steps: 0, outputTokens: 0, decodeMs: 0, ttftMs: 0 })

// Module state starts over on a hot reload; restore() picks the session's
// totals back up from the file the previous load wrote.
let sessionId: string | undefined
let totals = emptyTotals()
let lastTps: number | null = null
let dir: string | undefined

const round1 = (n: number) => Math.round(n * 10) / 10

async function metricsDir($: EngineInterface): Promise<string> {
  if (dir === undefined) {
    const config = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${await $.env.get('HOME')}/.claude`
    dir = `${config}/tps`
  }
  return dir
}

async function restore($: EngineInterface, path: string): Promise<void> {
  totals = emptyTotals()
  lastTps = null
  try {
    const prev = JSON.parse(String(await $.fs.read(path))) as Partial<Snapshot>
    totals = {
      steps: prev.steps ?? 0,
      outputTokens: prev.session_output_tokens ?? 0,
      decodeMs: prev.session_decode_ms ?? 0,
      ttftMs: prev.session_ttft_ms ?? 0,
    }
    lastTps = prev.last_tps ?? null
  } catch {
    // no file yet: a new session
  }
}

async function record(
  $: EngineInterface,
  model: string,
  ttftMs: number,
  decodeMs: number,
  outputTokens: number,
): Promise<void> {
  const id = await $.session.id()
  const path = `${await metricsDir($)}/${id}.json`
  if (id !== sessionId) {
    sessionId = id
    await restore($, path)
  }

  totals.steps += 1
  totals.outputTokens += outputTokens
  totals.decodeMs += decodeMs
  totals.ttftMs += ttftMs

  const tps = outputTokens >= MIN_TOKENS && decodeMs >= MIN_DECODE_MS ? round1((outputTokens / decodeMs) * 1000) : null
  if (tps !== null) lastTps = tps

  const snapshot: Snapshot = {
    model,
    updated_at: Date.now(),
    ttft_ms: Math.round(ttftMs),
    output_tokens: outputTokens,
    decode_ms: Math.round(decodeMs),
    tps,
    last_tps: lastTps,
    avg_tps: totals.decodeMs > 0 ? round1((totals.outputTokens / totals.decodeMs) * 1000) : null,
    avg_ttft_ms: Math.round(totals.ttftMs / totals.steps),
    steps: totals.steps,
    session_output_tokens: totals.outputTokens,
    session_decode_ms: Math.round(totals.decodeMs),
    session_ttft_ms: Math.round(totals.ttftMs),
  }
  await $.fs.write(path, JSON.stringify(snapshot))
}

export const register: Register = (on) => {
  on('turn.step', async function* ($, e, next) {
    // Subagents run in parallel with the main loop; only the main loop's
    // requests are what the status line describes.
    if (e.agentId !== undefined) return yield* next(e)

    const sentAt = performance.now()
    const stream = next(e)
    let firstAt: number | undefined
    for await (const chunk of stream) {
      const now = performance.now()
      firstAt ??= now
      if (chunk.kind === 'stop' && chunk.usage) {
        // Written before the stop chunk is passed on, so the status line
        // refresh that the engine's usage update triggers already reads it.
        await record($, e.model, firstAt - sentAt, now - firstAt, chunk.usage.output_tokens).catch(() => {})
      }
      yield chunk
    }
    return await stream.result
  })
}
