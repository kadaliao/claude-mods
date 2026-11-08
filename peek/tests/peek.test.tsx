import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { JPEG, PNG, WIDE_PNG } from './fixtures'

const VIEWPORT = { columns: 100, rows: 40, isFullscreen: false }

// Stands for the engine beneath the mod: rows draw as "row"; the conversation
// holds `messages` when the mod reads it back.
function engine(on: On, messages: unknown[] = []): void {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>row</Text>
  })
  on('session.messages', () => ({ value: messages as never }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
}

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

test('where the terminal draws no pictures, the row is left as it is', async ($, on) => {
  engine(on)
  const clock = mock.clock(on)
  on('ui.blit', () => ({ value: { deny: 'the Image draws its alt here: the terminal draws neither kitty placeholder images' } }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await returns($, 'toolu_10', 'Read', { file_path: '/work/e.png' }, PNG, 'image/png')

  const ui = await $.ui.mount(toolRow('toolu_10', 'Read', { file_path: '/work/e.png' }))
  expect(await ui.find({ type: 'Image' })).toBeDefined()
  await clock.advance(1000)
  expect(await ui.drawn()).toMatchObject({ type: 'Text', children: ['row'] })
  await ui.unmount()
})

test('where Claude Code does not recognise a terminal that draws pictures, one row says how to see them', async ($, on) => {
  engine(on)
  const clock = mock.clock(on)
  on('ui.blit', () => ({
    value: {
      deny: 'the Image draws its alt here: the terminal draws neither kitty placeholder images (probe: graphics reply OK, terminal herdr 0.9.5) nor iTerm2 inline images (yes only on an XTVERSION reply naming iTerm2 3.5 or later)',
    },
  }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await returns($, 'toolu_11', 'Read', { file_path: '/work/f.png' }, PNG, 'image/png')
  await returns($, 'toolu_12', 'Read', { file_path: '/work/g.png' }, JPEG, 'image/jpeg')

  const first = await $.ui.mount(toolRow('toolu_11', 'Read', { file_path: '/work/f.png' }))
  await clock.advance(1000)
  expect(await first.find({ type: 'Image' })).toBeUndefined()
  expect((await first.find({ type: 'Text', text: /CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1/ }))?.text).toBe(
    '看原图：用 CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1 启动 Claude Code',
  )
  const second = await $.ui.mount(toolRow('toolu_12', 'Read', { file_path: '/work/g.png' }))
  expect(await second.drawn()).toMatchObject({ type: 'Text', children: ['row'] })
  await first.unmount()
  await second.unmount()
})

test('a terminal that draws no pictures at all gets no hint', async ($, on) => {
  engine(on)
  const clock = mock.clock(on)
  on('ui.blit', () => ({
    value: {
      deny: 'the Image draws its alt here: the terminal draws neither kitty placeholder images (probe: no reply to the graphics query) nor iTerm2 inline images (yes only on an XTVERSION reply naming iTerm2 3.5 or later)',
    },
  }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await returns($, 'toolu_13', 'Read', { file_path: '/work/h.png' }, PNG, 'image/png')

  const ui = await $.ui.mount(toolRow('toolu_13', 'Read', { file_path: '/work/h.png' }))
  await clock.advance(1000)
  expect(await ui.drawn()).toMatchObject({ type: 'Text', children: ['row'] })
  await ui.unmount()
})
