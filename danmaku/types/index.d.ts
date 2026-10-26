// One comment, as the hooks module hands it to the lanes; each new one has a higher id.
export type Comment = {
  id: number
  text: string
  color?: string
  // Sent by the person with /danmaku <text>.
  isMine?: boolean
}

// What the band above the prompt draws from.
export type Band = {
  // The latest comments, oldest first: the lanes take the ones they have not seen.
  comments: Comment[]
  // The last id given.
  seq: number
  // Up while Claude works and for a while after the last comment.
  isShown: boolean
}

declare module 'claude-code' {
  interface PluginState {
    danmaku: { band: Shaped<Band>; isOn: boolean }
  }
}
