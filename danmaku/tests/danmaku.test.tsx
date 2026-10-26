import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import type { Item, Screen } from '../types'
import {
  MAX_CELLS,
  buildPrompt,
  cellsOf,
  charCells,
  describe,
  freeLane,
  layoutLane,
  parseDanmaku,
  placePending,
  reactionTo,
  step,
} from '../hooks/register'

const SURFACES = ['terminal', 'desktop'] as const
const PRESENTATION = { isFullscreen: true, columns: 160 } as const
const NB = ' '

const PANE = {
  plugin: 'danmaku',
  component: 'Pane',
  requestId: 'danmaku',
  props: {
    title: '弹幕',
    isFocused: false,
    bodyColumns: 41,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const item = (over: Partial<Item>): Item => ({ id: 1, text: 'ab', width: 2, lane: 0, x: 0, speed: 1, ...over })
const text = (runs: Array<{ text: string }>) => runs.map(r => r.text).join('')

// The engine beneath the plugin: a clock, a store (the pane switched on, unless
// `stored` says otherwise), a placed pane, and a model that answers `reply`.
function world(on: On, reply = '前排\n这波操作', stored: Record<string, unknown> = { isOn: true }) {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on, stored)
  const prompts: string[] = []
  const opened: string[] = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'danmaku' } }))
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => ({ value: undefined }))
  on('ui.panes', () => ({
    value: [{ id: 'danmaku', title: '弹幕', isShown: true, isFocused: false, isPlaced: true }],
  }))
  on('model.complete', (_, e) => {
    prompts.push(e.prompt)
    return {
      value: {
        isAnswered: true,
        text: reply,
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
    }
  })
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  return { clock, prompts, opened }
}

test('counts cells: CJK and emoji take two', () => {
  expect(charCells('a')).toBe(1)
  expect(charCells('中')).toBe(2)
  expect(charCells('！')).toBe(2)
  expect(charCells('🎉')).toBe(2)
  expect(charCells('️')).toBe(0)
  expect(cellsOf('前方高能！！')).toBe(12)
})

test('lays out a lane, cut at both edges', () => {
  expect(text(layoutLane([item({ x: 2 })], 6))).toBe(`${NB}${NB}ab`)
  // Half of 中 is past the left edge: blank, then 文.
  expect(text(layoutLane([item({ text: '中文', width: 4, x: -1 })], 6))).toBe(`${NB}文`)
  // 中 would straddle the right edge: nothing to draw.
  expect(layoutLane([item({ text: '中', width: 2, x: 5 })], 6)).toEqual([])
  const colored = layoutLane([item({ x: 0, color: 'success' }), item({ id: 2, text: 'cd', x: 3 })], 6)
  expect(colored).toEqual([{ text: 'ab', color: 'success' }, { text: `${NB}cd` }])
})

test('a lane is free once the comment ahead has moved on, and only if it is not caught', () => {
  const geo = { cols: 40, lanes: 3 }
  expect(freeLane([item({ x: 38, width: 4 })], geo, 1)).toBe(1)
  expect(freeLane([item({ x: 10, width: 4, speed: 1 })], geo, 1)).toBe(0)
  // A much faster comment would catch the slow one ahead: another lane.
  expect(freeLane([item({ x: 20, width: 10, speed: 0.2 })], geo, 3)).toBe(1)
})

test('a frame moves comments left, drops those gone, and places those waiting', () => {
  const geo = { cols: 20, lanes: 2 }
  const s: Screen = { items: [item({ x: 0.5, width: 2, speed: 3 })], pending: [{ text: '前排' }], seq: 1, total: 1 }
  const next = step(s, geo)
  expect(next.items.map(i => i.text)).toEqual(['前排'])
  expect(next.items[0]?.x).toBe(20)
  expect(next.total).toBe(2)
  // No lane has room: it waits.
  const full = placePending({ ...next, pending: [{ text: 'x' }] }, { cols: 20, lanes: 1 })
  expect(full.pending).toEqual([{ text: 'x' }])
})

test('reads the comments out of a reply', () => {
  expect(parseDanmaku('1. 前排\n- "666"\n弹幕3：好家伙\n\n前排\n「草」')).toEqual(['前排', '666', '好家伙'])
  expect(cellsOf(parseDanmaku('长'.repeat(40))[0] ?? '')).toBe(MAX_CELLS)
})

test('reacts at once to what matters', () => {
  expect(reactionTo({ kind: 'tool', tool: 'Bash', command: 'rm -rf build', isError: false })?.chance).toBe(1)
  expect(reactionTo({ kind: 'tool', tool: 'Bash', command: 'npm test', isError: true })?.texts).toContain('红了红了')
  expect(reactionTo({ kind: 'tool', tool: 'Bash', command: 'git push', isError: false })?.texts).toContain('推了推了')
  expect(reactionTo({ kind: 'done', reason: 'aborted', durationMs: 1 })?.chance).toBe(1)
})

test('describes a call in a few words for the model', () => {
  expect(describe('Bash', { command: 'npm test' }, true)).toBe('Claude 跑命令：npm test（失败了）')
  const patch = { structuredPatch: [{ lines: ['-a', '+b', '+c'] }] }
  expect(describe('Edit', { file_path: '/r/src/app.ts' }, false, patch)).toBe('Claude 改了文件 app.ts，+2 −1 行')
  expect(describe('mcp__srv__query', {}, false)).toBe('Claude 用了工具 query')
  expect(buildPrompt(['a'], ['前排'])).toContain('最近的弹幕：前排')
})

test('an rm -rf flies across the pane, on every surface', async ($, on) => {
  const { clock, opened } = world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(opened).toEqual(['danmaku'])
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
    await clock.advance(2500)
    expect(await ui.find({ type: 'Text', text: /前方高能|危险操作|手别抖|高能预警/ })).toBeDefined()
    await ui.unmount()
    await clock.advance(10_000)
  }
})

test("the model's comments join in once a few things have happened", async ($, on) => {
  const { clock, prompts } = world(on, '这波操作\n好家伙')
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.tool.call({ tool: 'Read', file_path: '/r/a.ts' })
  await $.tool.call({ tool: 'Read', file_path: '/r/b.ts' })
  await $.tool.call({ tool: 'Edit', file_path: '/r/a.ts', old_string: 'a', new_string: 'b' })
  await clock.advance(3000)
  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain('Claude 在读 a.ts')
  expect(await ui.find({ type: 'Text', text: /这波操作/ })).toBeDefined()
  await ui.unmount()
})

test('switched off, nothing is asked and nothing flies', async ($, on) => {
  const { clock, prompts } = world(on, '前排', {})
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  await $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(5000)
  expect(prompts).toEqual([])
  expect(await ui.find({ type: 'Text', text: /前方高能|危险操作|手别抖|高能预警/ })).toBeUndefined()
  await ui.unmount()
})

test('/danmaku <text> sends your own comment, and /danmaku off closes the pane', async ($, on) => {
  const { clock } = world(on, '', {})
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const sent = await $.command.run({ command: 'danmaku', args: '主播好帅', origin: { kind: 'composer' }, presentation: PRESENTATION })
  expect(sent.text).toBe('弹幕已发送。')
  await clock.advance(3000)
  expect(await ui.find({ type: 'Text', text: /主播好帅/ })).toBeDefined()
  const off = await $.command.run({ command: 'danmaku', args: 'off', origin: { kind: 'composer' }, presentation: PRESENTATION })
  expect(off.text).toBe('弹幕已关闭。')
  await ui.unmount()
})

test('an empty pane says so, and a screen an earlier version stored is declined', async ($, on) => {
  on('state.get', () => ({ value: { value: { items: [{ text: 'old' }] }, version: 1 } }))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Claude 一干活这里就热闹了/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /0 条弹幕/ })).toBeDefined()
  await ui.unmount()
})
