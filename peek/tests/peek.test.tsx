import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { hintFor } from '../hooks/register'
import { JPEG, PNG, WIDE_PNG } from './fixtures'

const VIEWPORT = { columns: 100, rows: 40, isFullscreen: false }

// Stands for the engine beneath the mod: rows draw as "row"; the conversation
// holds `messages` when the mod reads it back. Returns the panes it holds open,
// and what the commands the mod registered asked for.
function engine(on: On, messages: unknown[] = []) {
  const panes = new Map<string, { rows?: number; columns?: number; focus?: boolean }>()
  const immediate: Record<string, boolean> = {}
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>row</Text>
  })
  on('session.messages', () => ({ value: messages as never }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => {
    immediate[e.name] = e.immediate === true
    return { value: { command: e.name } }
  })
  on('ui.open', (_, e) => {
    panes.set(e.id, { rows: e.rows, columns: e.columns, focus: e.focus })
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_, e) => {
    panes.delete(e.id)
    return { value: undefined }
  })
  on('ui.panes', () => ({
    value: [...panes.keys()].map(id => ({ id, title: id, isShown: true, isPlaced: true, isFocused: true })),
  }))
  return { panes, immediate }
}

const peek = ($: Engine) =>
  $.command.run({ command: 'peek', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })

const PANE = {
  plugin: 'peek',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'peek',
  viewport: VIEWPORT,
  props: { title: '图片', isFocused: true, bodyColumns: 96, placement: 'inline', scroll: { offset: 0, bodyRows: 32 }, view: {} },
} as const

const callRow = (id: string, tool: string, input: unknown) => ({
  role: 'assistant',
  content: [{ type: 'tool_use', id, name: tool, input }],
})
const resultRow = (id: string, data: string, mime: string) => ({
  role: 'user',
  content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'image', source: { type: 'base64', media_type: mime, data } }] }],
})

// The rows a turn appends when Claude calls `tool` and it returns one picture.
async function returns($: Engine, id: string, tool: string, input: unknown, data: string, mime: string): Promise<void> {
  await $.session.append({
    door: 'response',
    origin: { kind: 'model', model: 'claude' },
    uuid: `call-${id}`,
    message: { type: 'assistant', ...callRow(id, tool, input) } as never,
  })
  await $.session.append({
    door: 'tool-result',
    origin: { kind: 'tool', tool },
    uuid: `result-${id}`,
    message: { type: 'user', ...resultRow(id, data, mime) } as never,
  })
}

const toolRow = (id: string, tool: string, input: unknown, extra: object = {}) =>
  ({
    plugin: 'peek',
    surface: 'terminal',
    component: 'ToolUse',
    requestId: id,
    viewport: VIEWPORT,
    props: { tool_use_id: id, tool, input, isRunning: false, isErrored: false, isInterrupted: false, isExpanded: false, ...extra },
  }) as const

test('a picture Read returns shows under its row', async ($, on) => {
  engine(on)
  await returns($, 'toolu_1', 'Read', { file_path: '/work/shot.png' }, PNG, 'image/png')

  const ui = await $.ui.mount(toolRow('toolu_1', 'Read', { file_path: '/work/shot.png' }))
  expect((await ui.find({ type: 'Text', text: 'row' }))?.text).toBe('row')
  const image = await ui.find({ type: 'Image' })
  expect(image?.props.alt).toBe('[图片 shot.png 16×8]')
  expect(image?.props.source).toEqual({ png: PNG })
  await ui.unmount()
})

test('a screenshot JPEG is decoded into pixels for the Image', async ($, on) => {
  engine(on)
  await returns($, 'toolu_2', 'mcp__claude-in-chrome__computer', { action: 'screenshot' }, JPEG, 'image/jpeg')

  const ui = await $.ui.mount(toolRow('toolu_2', 'mcp__claude-in-chrome__computer', { action: 'screenshot' }))
  const image = await ui.find({ type: 'Image' })
  const source = image?.props.source as { rgba?: string; width?: number; height?: number }
  expect(image?.props.alt).toBe('[图片 Chrome 截图 16×8]')
  expect(source.width).toBe(16)
  expect(source.height).toBe(8)
  expect(typeof source.rgba).toBe('string')
  await ui.unmount()
})

test('a PNG larger than its thumbnail is sent shrunk, not whole', async ($, on) => {
  engine(on)
  await returns($, 'toolu_14', 'Read', { file_path: '/work/wide.png' }, WIDE_PNG, 'image/png')

  const ui = await $.ui.mount(toolRow('toolu_14', 'Read', { file_path: '/work/wide.png' }))
  const image = await ui.find({ type: 'Image' })
  expect(image?.props).toMatchObject({ columns: 20, rows: 5 })
  const source = image?.props.source as { png?: string; rgba?: string; width?: number; height?: number }
  expect(source.png).toBeUndefined()
  expect(source.width).toBe(240)
  expect(source.height).toBe(120)
  await ui.unmount()
})

test('ctrl+o draws the picture larger', async ($, on) => {
  engine(on)
  // A Read's own result, saying the picture is 1600×800.
  const output = { type: 'image', file: { base64: PNG, type: 'image/png', originalSize: 226, dimensions: { displayWidth: 1600, displayHeight: 800 } } }
  const input = { file_path: '/work/wide.png' }

  const small = await $.ui.mount(toolRow('toolu_3', 'Read', input, { output }))
  expect((await small.find({ type: 'Image' }))?.props).toMatchObject({ columns: 20, rows: 5 })
  await small.unmount()
  const big = await $.ui.mount(toolRow('toolu_3', 'Read', input, { output, isExpanded: true }))
  expect((await big.find({ type: 'Image' }))?.props).toMatchObject({ columns: 94, rows: 24 })
  await big.unmount()
})

test('a Read the mod did not see draws from its own result', async ($, on) => {
  engine(on)
  const output = { type: 'image', file: { base64: PNG, type: 'image/png', originalSize: 226, dimensions: { displayWidth: 16, displayHeight: 8 } } }

  const ui = await $.ui.mount(toolRow('toolu_5', 'Read', { file_path: '/work/b.png' }, { output }))
  expect((await ui.find({ type: 'Image' }))?.props.source).toEqual({ png: PNG })
  await ui.unmount()
})

test('a row with no picture is left as the engine draws it', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount(toolRow('toolu_6', 'Bash', { command: 'ls' }))
  expect(await ui.drawn()).toMatchObject({ type: 'Text' })
  await ui.unmount()
})

test('a folded "Read N files" line shows the pictures under it', async ($, on) => {
  engine(on)
  await returns($, 'toolu_7', 'Read', { file_path: '/work/c.png' }, PNG, 'image/png')
  await returns($, 'toolu_8', 'Read', { file_path: '/work/d.jpg' }, JPEG, 'image/jpeg')
  const call = (id: string, path: string) => ({ tool_use_id: id, tool: 'Read', input: { file_path: path }, isRunning: false, isErrored: false, isInterrupted: false })

  const ui = await $.ui.mount({
    plugin: 'peek',
    surface: 'terminal',
    component: 'ToolGroup',
    viewport: VIEWPORT,
    props: { calls: [call('toolu_7', '/work/c.png'), call('toolu_8', '/work/d.jpg')], isActive: false, isExpanded: false },
  })
  expect(await ui.findAll({ type: 'Image' })).toHaveLength(2)
  await ui.unmount()
})

test('a resumed session draws the pictures it had read', async ($, on) => {
  engine(on, [callRow('toolu_9', 'mcp__computer-use__screenshot', {}), resultRow('toolu_9', JPEG, 'image/jpeg')])
  const clock = mock.clock(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(0)

  const ui = await $.ui.mount(toolRow('toolu_9', 'mcp__computer-use__screenshot', {}))
  expect((await ui.find({ type: 'Image' }))?.props.alt).toBe('[图片 屏幕截图 16×8]')
  await ui.unmount()
})

// Claude Code's reasons for drawing an Image's alt, as it words them.
const UNNAMED = 'the Image draws its alt here: the terminal draws neither kitty placeholder images (probe: graphics reply OK, terminal herdr 0.9.5) nor iTerm2 inline images (yes only on an XTVERSION reply naming iTerm2 3.5 or later)'
const UNASKED = 'the Image draws its alt here: the terminal draws neither kitty placeholder images (env: terminal=herdr, not asked yet, no answer) nor iTerm2 inline images (yes only on an XTVERSION reply naming iTerm2 3.5 or later, no answer)'
const TMUX = 'the Image draws its alt here: images inside tmux need tmux 3.3 or later with allow-passthrough and focus-events on: run `tmux set -g allow-passthrough on` and `tmux set -g focus-events on`, detach and attach tmux again, then restart Claude Code'

// A session on a terminal that refuses pictures for `deny`: the first picture's row, after the check.
async function refused($: Engine, on: On, deny: string, told: string[] = []) {
  engine(on)
  mock.store(on, told.length > 0 ? { told } : undefined)
  const clock = mock.clock(on)
  on('ui.blit', () => ({ value: { deny } }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await returns($, 'toolu_20', 'Read', { file_path: '/work/f.png' }, PNG, 'image/png')
  await returns($, 'toolu_21', 'Read', { file_path: '/work/g.png' }, JPEG, 'image/jpeg')
  const first = await $.ui.mount(toolRow('toolu_20', 'Read', { file_path: '/work/f.png' }))
  expect(await first.find({ type: 'Image' })).toBeDefined()
  await clock.advance(1000)
  return first
}

test('herdr, unrecognised: the first row says how to turn pictures on, the rest stay as they are', async ($, on) => {
  const first = await refused($, on, UNASKED)
  expect(await first.find({ type: 'Image' })).toBeUndefined()
  expect((await first.find({ type: 'Text', text: /CLAUDE_CODE_FORCE_TERMINAL_IMAGES/ }))?.text).toBe(
    '图片没显示（终端：herdr）。如果它支持 kitty 图片协议，在 ~/.claude/settings.json 的 env 里加上 "CLAUDE_CODE_FORCE_TERMINAL_IMAGES": "1"，重启 Claude Code',
  )
  const second = await $.ui.mount(toolRow('toolu_21', 'Read', { file_path: '/work/g.png' }))
  expect(await second.drawn()).toMatchObject({ type: 'Text', children: ['row'] })
  await first.unmount()
  await second.unmount()
})

test('a terminal that answered the graphics query gets the hint too, naming it', async ($, on) => {
  const first = await refused($, on, UNNAMED)
  expect((await first.find({ type: 'Text', text: /CLAUDE_CODE_FORCE_TERMINAL_IMAGES/ }))?.text).toContain('终端：herdr 0.9.5')
  await first.unmount()
})

test('a terminal told before is not told again', async ($, on) => {
  const first = await refused($, on, UNASKED, ['herdr'])
  expect(await first.drawn()).toMatchObject({ type: 'Text', children: ['row'] })
  await first.unmount()
})

test('inside tmux the hint is what tmux needs', async ($, on) => {
  const first = await refused($, on, TMUX)
  expect((await first.find({ type: 'Text', text: /allow-passthrough/ }))?.text).toBe(`图片没显示：${TMUX.slice(30)}`)
  await first.unmount()
})

test('hints by terminal', () => {
  expect(hintFor(UNASKED)?.terminal).toBe('herdr')
  expect(hintFor('the Image draws its alt here: the terminal draws neither kitty placeholder images (env: terminal=iTerm.app, not asked yet) nor iTerm2 inline images (x)')?.text).toBe(
    'iTerm2 要在全屏模式下才能显示图片：输入 /tui fullscreen',
  )
  expect(hintFor('the Image draws its alt here: the terminal draws neither kitty placeholder images (env: terminal=unknown, not asked yet) nor iTerm2 inline images (x)')?.terminal).toBe('这个终端')
  expect(hintFor('the Image draws its alt here: every 8-bit image id is in use')).toBeUndefined()
})

// A Read's own result, saying the picture is 1600×800.
const WIDE_OUTPUT = { type: 'image', file: { base64: PNG, type: 'image/png', originalSize: 226, dimensions: { displayWidth: 1600, displayHeight: 800 } } }

// The engine's settings, with verbose on or off.
function settings(on: On, verbose: boolean): void {
  const row = { key: 'verbose', label: 'Verbose output', kind: 'boolean', value: verbose, provider: { plugin: 'engine', tier: 'core' }, isLocked: false }
  on('config.list', () => ({ value: [row] as never }))
  on('config.set', (_, e) => ({ value: e.value }))
}

test('with verbose on, every row says it is expanded and the pictures keep their size', async ($, on) => {
  engine(on)
  settings(on, true)
  const clock = mock.clock(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(0)

  const ui = await $.ui.mount(toolRow('toolu_30', 'Read', { file_path: '/work/wide.png' }, { output: WIDE_OUTPUT, isExpanded: true }))
  expect((await ui.find({ type: 'Image' }))?.props).toMatchObject({ columns: 20, rows: 5 })
  await ui.unmount()
})

test('turning verbose on in /config takes the large pictures back to their size', async ($, on) => {
  engine(on)
  settings(on, false)
  const clock = mock.clock(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(0)
  const row = toolRow('toolu_31', 'Read', { file_path: '/work/wide.png' }, { output: WIDE_OUTPUT, isExpanded: true })

  const before = await $.ui.mount(row)
  expect((await before.find({ type: 'Image' }))?.props).toMatchObject({ columns: 94, rows: 24 })
  await before.unmount()
  await $.config.set({ key: 'verbose', value: true, previous: false, provider: { plugin: 'engine', tier: 'core' }, origin: { kind: 'composer' } })
  const after = await $.ui.mount(row)
  expect((await after.find({ type: 'Image' }))?.props).toMatchObject({ columns: 20, rows: 5 })
  await after.unmount()
})

const promptRow = (id: string, text: string) =>
  ({
    plugin: 'peek',
    surface: 'terminal',
    component: 'UserMessage',
    requestId: id,
    viewport: VIEWPORT,
    props: { text, origin: { kind: 'composer' }, isExpanded: false },
  }) as const
const pastedBlocks = (text: string, data: string, mime: string) => [
  { type: 'text', text },
  { type: 'image', source: { type: 'base64', media_type: mime, data } },
]

test('a picture pasted into a prompt shows under the prompt', async ($, on) => {
  engine(on)
  await $.session.append({
    door: 'prompt',
    origin: { kind: 'composer' },
    uuid: 'row-1',
    message: { type: 'user', role: 'user', content: pastedBlocks('[Image #1] 看看这张', PNG, 'image/png') } as never,
  })

  const ui = await $.ui.mount(promptRow('row-1', '[Image #1] 看看这张'))
  expect((await ui.find({ type: 'Text', text: 'row' }))?.text).toBe('row')
  const image = await ui.find({ type: 'Image' })
  expect(image?.props.alt).toBe('[图片 粘贴的图 16×8]')
  expect(image?.props.source).toEqual({ png: PNG })
  await ui.unmount()
})

test('a resumed session finds a pasted picture by its prompt', async ($, on) => {
  // As the conversation reads back: reminders before the prompt, the picture's source after it.
  const content = [
    { type: 'text', text: '<system-reminder>\nnotes\n</system-reminder>' },
    ...pastedBlocks('[Image #1] 看看这张', JPEG, 'image/jpeg'),
    { type: 'text', text: '[Image: source: /tmp/shot.jpg]' },
  ]
  engine(on, [{ role: 'user', content }])
  const clock = mock.clock(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(0)

  const ui = await $.ui.mount(promptRow('row-unknown', '[Image #1] 看看这张'))
  expect((await ui.find({ type: 'Image' }))?.props.alt).toBe('[图片 粘贴的图 16×8]')
  await ui.unmount()
})

test('a prompt with no picture is left as the engine draws it', async ($, on) => {
  engine(on)
  await $.session.append({
    door: 'prompt',
    origin: { kind: 'composer' },
    uuid: 'row-2',
    message: { type: 'user', role: 'user', content: [{ type: 'text', text: '看看这张' }] } as never,
  })
  const ui = await $.ui.mount(promptRow('row-2', '看看这张'))
  expect(await ui.drawn()).toMatchObject({ type: 'Text', children: ['row'] })
  await ui.unmount()
})

test('the model is told that pictures it reads are shown, in a terminal session only', async ($, on) => {
  engine(on)
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'You are Claude Code.', scope: 'shared' }] }))
  const compose = (surfaces: ('terminal' | 'desktop')[]) =>
    $.prompt.compose({ model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces, tools: ['Read', 'Bash'], outputStyle: null, traits: [] })

  const inTerminal = await compose(['terminal'])
  const note = inTerminal.sections.find(s => s.id === 'peek:pictures')
  expect(note?.scope).toBe('session')
  expect(note?.text).toContain('To show the person a picture, Read it.')
  expect(inTerminal.sections[0]?.id).toBe('intro')

  const headless = await compose([])
  expect(headless.sections.map(s => s.id)).toEqual(['intro'])
})

// --- /peek: the session's pictures large, in a pane ---------------------------

const caption = async (ui: { find: (q: object) => Promise<{ text?: string } | undefined> }) =>
  (await ui.find({ type: 'Text', text: /^\d+\/\d+/ }))?.text

test('/peek opens a pane on the newest picture, drawn as large as the pane', async ($, on) => {
  const e = engine(on)
  mock.clock(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(e.immediate.peek).toBe(true)
  await returns($, 'toolu_20', 'Read', { file_path: '/work/wide.png' }, WIDE_PNG, 'image/png')
  await returns($, 'toolu_21', 'mcp__claude-in-chrome__computer', { action: 'screenshot' }, JPEG, 'image/jpeg')

  const ran = await peek($)
  expect(ran.text).toBeUndefined()
  expect(e.panes.get('peek')).toMatchObject({ rows: 32, columns: 45, focus: true })

  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 96 } })
  expect(await caption(ui)).toBe('2/2 · Chrome 截图 · 16×8')
  await ui.unmount()

  // The wide one fills the pane's width, past any thumbnail's.
  await returns($, 'toolu_22', 'Read', { file_path: '/work/wide2.png' }, WIDE_PNG, 'image/png')
  const wide = await $.ui.mount(PANE)
  expect(await caption(wide)).toBe('2/2 · wide2.png · 600×300')
  expect((await wide.find({ type: 'Image' }))?.props).toMatchObject({ columns: 75, rows: 19 })
  await wide.unmount()
})

test('in the pane, p and n turn through the pictures, round from either end', async ($, on) => {
  engine(on)
  mock.clock(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await returns($, 'toolu_23', 'Read', { file_path: '/work/a.png' }, PNG, 'image/png')
  await returns($, 'toolu_24', 'mcp__claude-in-chrome__computer', { action: 'screenshot' }, JPEG, 'image/jpeg')
  await peek($)

  const ui = await $.ui.mount(PANE)
  expect(await caption(ui)).toBe('2/2 · Chrome 截图 · 16×8')
  await ui.press({ key: 'prev' })
  expect(await caption(ui)).toBe('1/2 · a.png · 16×8')
  await ui.press({ key: 'prev' })
  expect(await caption(ui)).toBe('2/2 · Chrome 截图 · 16×8')
  await ui.press({ key: 'next' })
  expect(await caption(ui)).toBe('1/2 · a.png · 16×8')
  await ui.unmount()
})

test('/peek again closes the pane, and opens it on the newest next time', async ($, on) => {
  const e = engine(on)
  mock.clock(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await returns($, 'toolu_25', 'Read', { file_path: '/work/a.png' }, PNG, 'image/png')
  await returns($, 'toolu_26', 'Read', { file_path: '/work/b.png' }, WIDE_PNG, 'image/png')
  await peek($)
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'prev' })
  expect(await caption(ui)).toBe('1/2 · a.png · 16×8')
  await ui.unmount()

  expect((await peek($)).text).toBeUndefined()
  expect(e.panes.has('peek')).toBe(false)

  await peek($)
  const again = await $.ui.mount(PANE)
  expect(await caption(again)).toBe('2/2 · b.png · 600×300')
  await again.unmount()
})

test('/peek with no pictures yet says so and opens nothing', async ($, on) => {
  const e = engine(on)
  mock.clock(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((await peek($)).text).toBe('这个会话里还没有图。')
  expect(e.panes.size).toBe(0)
})
