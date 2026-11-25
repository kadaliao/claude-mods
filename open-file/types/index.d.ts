// The file a tab shows: its absolute path ('' when the tab has none), the line
// to bring into view, `seq` counting the clicks on it (each one scrolls to its
// line) and `rev` counting the edits Claude made to the file.
export type View = { path: string; line?: number; seq: number; rev: number }

declare module 'claude-code' {
  interface PluginState {
    'open-file': {
      // What each tab shows, by its pane id.
      tab: StateFamily<Shaped<View>>
    }
  }
}
