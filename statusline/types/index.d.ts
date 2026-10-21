// Token totals of every model request this session made, subagents' included.
export type Tokens = { input: number; output: number; cacheRead: number; cacheWrite: number }

// Speed of the main loop's model requests.
export type Speed = {
  ttftMs: number | null
  // Output tokens/s of the latest request long enough to measure.
  tps: number | null
  steps: number
  outputTokens: number
  decodeMs: number
  ttftTotalMs: number
}

export type Meter = {
  sessionId: string
  tokens: Tokens
  speed: Speed
  // The model and effort the latest main-loop request named.
  model: string | null
  effort: string | null
}

export type Git = { branch: string; ahead: number; behind: number; changed: number }

declare module 'claude-code' {
  interface PluginState {
    statusline: { meter: Meter | null; git: Git | null }
  }
}
