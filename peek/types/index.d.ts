// One picture a tool call returned, as its row draws it. Its bytes stay in the
// module, not in state: a reload reads them back from the conversation.
export type Shot = {
  // A hash of the picture's bytes.
  id: string
  mime: string
  width: number
  height: number
  // What stands in its place where it cannot be drawn: a file name, "Chrome 截图".
  label: string
}

// Whether the terminal draws pictures, as found out this session; `hintAt` is
// the row that says how to get them (`hint`), the first time on this terminal.
export type Probe = { canDraw: 'unknown' | 'yes' | 'no'; hintAt?: string; hint?: string }

declare module 'claude-code' {
  interface PluginState {
    peek: {
      // The pictures each tool call returned, by its tool_use_id.
      shots: StateFamily<Shot[]>
      probe: Shaped<Probe>
    }
  }
}
