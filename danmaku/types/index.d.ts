// One comment on screen: where it is in cells and how far it moves each frame.
export type Item = {
  id: number
  text: string
  // Its width in terminal cells.
  width: number
  lane: number
  // The column of its first cell; negative once its head has left the pane.
  x: number
  speed: number
  color?: string
  // Sent by the person with /danmaku <text>.
  isMine?: boolean
}

// A comment waiting for a lane with room.
export type Pending = { text: string; color?: string; isMine?: boolean }

export type Screen = {
  items: Item[]
  pending: Pending[]
  seq: number
  // Comments shown this session.
  total: number
}

declare module 'claude-code' {
  interface PluginState {
    danmaku: { screen: Shaped<Screen>; isOn: boolean }
  }
}
