import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import type { Band } from '../types'
import { addComments, buildPrompt, describe, parseDanmaku, reactionTo } from '../hooks/register'
import type { Flying, Lanes } from '../hooks/screen'
import { cellsOf, charCells, emptyLanes, freeLane, layoutLane, place, step } from '../hooks/screen'

const SURFACES = ['terminal', 'desktop'] as const
const PRESENTATION = { isFullscreen: true, columns: 160 } as const
const NB = '\u00a0'
const HECKLE = /前方高能|危险操作|手别抖|高能预警/

const BAND = {
  plugin: 'danmaku',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: true,
    maxRows: 20,
    bodyColumns: 60,
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
  viewport: { columns: 65, rows: 40 },
} as const
const IDLE = { ...BAND, props: { ...BAND.props, isWorking: false } }

const fly = (over: Partial<Flying>): Flying => ({ id: 1, text: 'ab', width: 2, lane: 0, x: 0, speed: 1, ...over })
const text = (runs: Array<{ text: string }>) => runs.map(r => r.text).join('')

// The engine beneath the plugin: a clock, a store (switched on, unless `stored` says
// otherwise), a model that answers `reply`, and a band that holds a status row.
function world(on: On, reply = '前排\n这波操作', stored: Record<string, unknown> = { isOn: true }) {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on, stored)
  const prompts: string[] = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'danmaku' } }))
  on('ui.close', () => ({ value: undefined }))
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
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>status</Text>
  })
  return { clock, prompts }
}

const run = (args: string) => ({ command: 'danmaku', args, origin: { kind: 'composer' }, presentation: PRESENTATION }) as const
const done = { answer: 'done', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' } as const

test('counts cells: CJK and emoji take two', () => {
  expect(charCells('a')).toBe(1)
  expect(charCells('中')).toBe(2)
  expect(charCells('！')).toBe(2)
  expect(charCells('🎉')).toBe(2)
  expect(charCells('️')).toBe(0)
  expect(cellsOf('前方高能！！')).toBe(12)
})

test('lays out a lane, cut at both edges', () => {
  expect(text(layoutLane([fly({ x: 2 })], 6))).toBe(`${NB}${NB}ab`)
  // Half of 中 is past the left edge: blank, then 文.
  expect(text(layoutLane([fly({ text: '中文', width: 4, x: -1 })], 6))).toBe(`${NB}文`)
  // 中 would straddle the right edge: nothing to draw.
  expect(layoutLane([fly({ text: '中', width: 2, x: 5 })], 6)).toEqual([])
  const colored = layoutLane([fly({ x: 0, color: 'success' }), fly({ id: 2, text: 'cd', x: 3 })], 6)
  expect(colored).toEqual([{ text: 'ab', color: 'success' }, { text: `${NB}cd` }])
})

test('a comment wider than the lane shows every letter on its way across', () => {
  const geo = { cols: 12, lanes: 1 }
  const long = '这条弹幕比整条跑道还要长得多'
  let s = place(emptyLanes, [{ id: 1, text: long }], geo)
  const shown = new Set<string>()
  while (s.items.length > 0) {
    for (const ch of text(layoutLane(s.items, geo.cols))) shown.add(ch)
    s = step(s, [], geo)
  }
  for (const ch of long) expect(shown.has(ch)).toBe(true)
})

test('a lane is free once the comment ahead has moved on, and only if it is not caught', () => {
  const geo = { cols: 40, lanes: 3 }
  expect(freeLane([fly({ x: 38, width: 4 })], geo, 1)).toBe(1)
  expect(freeLane([fly({ x: 10, width: 4, speed: 1 })], geo, 1)).toBe(0)
  // A much faster comment would catch the slow one ahead: another lane.
  expect(freeLane([fly({ x: 20, width: 10, speed: 0.2 })], geo, 3)).toBe(1)
})

test('a frame moves comments left, drops those gone, and takes the new ones', () => {
  const geo = { cols: 20, lanes: 2 }
  const s: Lanes = { items: [fly({ x: 0.5, width: 2, speed: 3 })], pending: [], seen: 1 }
  const next = step(s, [{ id: 1, text: 'ab' }, { id: 2, text: '前排' }], geo)
  expect(next.items.map(i => i.text)).toEqual(['前排'])
  expect(next.items[0]?.x).toBe(20)
  expect(next.seen).toBe(2)
  // Seen already: not taken twice.
  expect(step(next, [{ id: 2, text: '前排' }], geo).items).toHaveLength(1)
  // No lane has room: it waits.
  const full = place(next, [{ id: 3, text: 'x' }], { cols: 20, lanes: 1 })
  expect(full.pending).toEqual([{ id: 3, text: 'x' }])
})

test('new comments take the next ids, the latest few kept', () => {
  const b: Band = { comments: [], seq: 5, isShown: false }
  const added = addComments(b, [{ text: 'a' }, { text: 'b', color: 'error' }])
  expect(added).toEqual({ comments: [{ text: 'a', id: 6 }, { text: 'b', color: 'error', id: 7 }], seq: 7, isShown: true })
  let many = b
  for (let i = 0; i < 30; i++) many = addComments(many, [{ text: String(i) }])
  expect(many.comments.length).toBeLessThan(30)
  expect(many.comments.at(-1)).toEqual({ text: '29', id: 35 })
})

test('reads the comments out of a reply', () => {
  expect(parseDanmaku('1. 前排\n- "666"\n弹幕3：好家伙\n\n前排\n「草」')).toEqual(['前排', '666', '好家伙'])
  expect(parseDanmaku('长'.repeat(40))).toEqual(['长'.repeat(40)])
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

test('an rm -rf flies across the lanes above the prompt, on every surface', async ($, on) => {
  const { clock } = world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
    await clock.advance(100)
    await ui.advance(2000)
    expect(await ui.find({ type: 'Text', text: HECKLE, in: 'lanes' })).toBeDefined()
    // It flies on, and is gone once it has crossed.
    await ui.advance(12_000)
    expect(await ui.find({ type: 'Text', text: HECKLE, in: 'lanes' })).toBeUndefined()
    await ui.unmount()
  }
})

test('the lanes sit above what else the band holds', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.drawn()).toMatchObject({
    type: 'Box',
    children: [{ type: 'Client', props: { key: 'lanes', height: 3 } }, { type: 'Text' }],
  })
  await ui.unmount()
})

test("the model's comments join in once a few things have happened", async ($, on) => {
  const { clock, prompts } = world(on, '这波操作\n好家伙')
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await $.tool.call({ tool: 'Read', file_path: '/r/a.ts' })
  await $.tool.call({ tool: 'Read', file_path: '/r/b.ts' })
  await $.tool.call({ tool: 'Edit', file_path: '/r/a.ts', old_string: 'a', new_string: 'b' })
  await clock.advance(3000)
  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain('Claude 在读 a.ts')
  await ui.advance(1000)
  expect(await ui.find({ type: 'Text', text: /这波操作/, in: 'lanes' })).toBeDefined()
  await ui.unmount()
})

test('the lanes fold a while after the last comment, once Claude is idle', async ($, on) => {
  const { clock } = world(on, '')
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...IDLE, surface: 'terminal' })
  expect(await ui.find({ type: 'Client' })).toBeUndefined()
  await $.turn.start({ text: '', turnId: 't1' })
  expect(await ui.find({ type: 'Client' })).toBeDefined()
  // Working: they stay up, however long.
  await clock.advance(60_000)
  expect(await ui.find({ type: 'Client' })).toBeDefined()
  await $.turn.complete(done)
  await clock.advance(5000)
  expect(await ui.find({ type: 'Client' })).toBeDefined()
  await clock.advance(10_000)
  expect(await ui.find({ type: 'Client' })).toBeUndefined()
  await ui.unmount()
})

test('switched off, nothing is asked and nothing is drawn', async ($, on) => {
  const { clock, prompts } = world(on, '前排', {})
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  await $.turn.complete(done)
  await clock.advance(5000)
  expect(prompts).toEqual([])
  expect(await ui.find({ type: 'Client' })).toBeUndefined()
  expect((await ui.find({ type: 'Text' }))?.text).toBe('status')
  await ui.unmount()
})

test('/danmaku switches on with a comment, /danmaku <text> sends yours, /danmaku off folds the lanes', async ($, on) => {
  world(on, '', {})
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...IDLE, surface: 'terminal' })
  expect((await $.command.run(run(''))).text).toContain('弹幕已开启')
  await ui.advance(1000)
  expect(await ui.find({ type: 'Text', text: /前排占座|来了来了|弹幕护体/, in: 'lanes' })).toBeDefined()
  expect((await $.command.run(run('主播好帅'))).text).toBe('弹幕已发送。')
  await ui.advance(1000)
  expect(await ui.find({ type: 'Text', text: /主播好帅/, in: 'lanes' })).toBeDefined()
  expect((await $.command.run(run('off'))).text).toBe('弹幕已关闭。')
  expect(await ui.find({ type: 'Client' })).toBeUndefined()
  await ui.unmount()
})

test('/danmaku says so when a mod over the band keeps the lanes from drawing', async ($, on) => {
  world(on, '', {})
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // Nothing mounted: the band never reached danmaku, as under statusline 0.1.0.
  expect((await $.command.run(run(''))).text).toContain('statusline@kadaliao')
  await $.command.run(run('off'))
  const ui = await $.ui.mount({ ...IDLE, surface: 'terminal' })
  expect((await $.command.run(run(''))).text).not.toContain('statusline@kadaliao')
  await ui.unmount()
})

test('a band an earlier version stored is declined', async ($, on) => {
  world(on)
  on('state.get', (_, e, next) =>
    e.key === 'band' ? { value: { value: { items: [{ text: 'old' }] }, version: 1 } } : next(e),
  )
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...IDLE, surface: 'desktop' })
  expect(await ui.find({ type: 'Client' })).toBeUndefined()
  await ui.unmount()
})

test('with no band drawn anywhere (a claude -p run), the model is never asked', async ($, on) => {
  const { clock, prompts } = world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: false })
  await $.tool.call({ tool: 'Read', file_path: '/r/a.ts' })
  await $.tool.call({ tool: 'Read', file_path: '/r/b.ts' })
  await $.tool.call({ tool: 'Read', file_path: '/r/c.ts' })
  await $.turn.complete(done)
  await clock.advance(10_000)
  expect(prompts).toEqual([])
})

test('the lanes option sets the rows, and a short band gives way', { options: { lanes: '2' } }, async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Client' }))?.props).toMatchObject({ height: 2 })
  await ui.unmount()
  const short = await $.ui.mount({ ...BAND, props: { ...BAND.props, maxRows: 4 }, surface: 'terminal' })
  expect((await short.find({ type: 'Client' }))?.props).toMatchObject({ height: 1 })
  await short.unmount()
  const tiny = await $.ui.mount({ ...BAND, props: { ...BAND.props, maxRows: 3 }, surface: 'terminal' })
  expect(await tiny.find({ type: 'Client' })).toBeUndefined()
  await tiny.unmount()
})

test('two surfaces drawing at once each fly their own lanes', async ($, on) => {
  const { clock } = world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const term = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const desk = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  await clock.advance(100)
  await term.advance(2000)
  await desk.advance(2000)
  for (const ui of [term, desk]) expect(await ui.find({ type: 'Text', text: HECKLE, in: 'lanes' })).toBeDefined()
  await term.advance(12_000)
  expect(await term.find({ type: 'Text', text: HECKLE, in: 'lanes' })).toBeUndefined()
  expect(await desk.find({ type: 'Text', text: HECKLE, in: 'lanes' })).toBeDefined()
  await term.unmount()
  await desk.unmount()
})
