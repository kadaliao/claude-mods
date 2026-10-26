// What one turn of the main loop did, tallied as its tool calls end.
export type Report = {
  startedAt: number
  // Set when the turn ended; null while it runs.
  endedAt: number | null
  // Files Edit, Write or NotebookEdit changed, each once.
  files: string[]
  added: number
  removed: number
  // Bash calls.
  commands: number
  // Read, Grep and Glob calls.
  reads: number
  // Tool calls that ended in an error.
  failed: number
}

export type Prefs = { isMuted: boolean; isReportOn: boolean }

declare module 'claude-code' {
  interface PluginState {
    ambience: { report: Shaped<Report | null>; prefs: Shaped<Prefs> }
  }
}
