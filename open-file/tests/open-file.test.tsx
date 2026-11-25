import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { tabIdOf, windowOf } from '../hooks/register'
import { fileHref, findHits, linkify, parseHref, resolvePath } from '../hooks/paths'

const CWD = '/repo'
const HOME = '/Users/me'
const FILES: Record<string, string> = {
  '/repo/src/app.ts': 'line one\nline two\nline three\n',
  '/repo/README.md': '# hi\n',
  '/Users/me/notes/todo.txt': 'milk\n',
  '/repo/a/index.ts': 'a\n',
  '/repo/b/index.ts': 'b\n',
  '/Users/me/Desktop/截图 2026-11-25.png': 'png\n',
  '/repo/工作记录/配置说明.md': 'one\ntwo\n',
}
for (let i = 0; i < 10; i++) FILES[`/repo/f${i}.ts`] = `${i}\n`
const VIEWPORT = { columns: 160, rows: 40, isFullscreen: true }

// The panes the mod has open, in open order, as the engine lists them.
type Open = { id: string; title: string }

// Stands for the engine: a file system holding FILES, the session in CWD,
// and the panes the mod opened, kept in `panes`.
function engine(on: On, panes: Open[] = []) {
  on('session.cwd', () => ({ value: CWD }))
  on('env.get', () => ({ value: HOME }))
  on('fs.stat', (_, e) => {
    const text = FILES[e.path]
    if (text === undefined) throw new Error(`stat ${e.path} failed: ENOENT`)
    return { value: { kind: 'file', size: text.length, mtimeMs: 1, isLink: false } }
  })
  on('fs.read', (_, e) => {
    const text = FILES[e.path]
    if (text === undefined) throw new Error(`read ${e.path} failed: ENOENT`)
    return { value: text }
  })
  on('fs.exists', (_, e) => ({ value: FILES[e.path] !== undefined }))
  on('clock.sleep', () => ({ value: undefined }))
  on('ui.open', (_, e) => {
    const at = panes.findIndex(p => p.id === e.id)
    if (at < 0) panes.push({ id: e.id, title: e.title ?? e.id })
    else panes[at] = { id: e.id, title: e.title ?? e.id }
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_, e) => {
    const at = panes.findIndex(p => p.id === e.id)
    if (at >= 0) panes.splice(at, 1)
    return { value: undefined }
  })
  // The pane opened last is the one shown.
  on('ui.panes', () => ({ value: panes.map((p, i) => ({ ...p, isShown: i === panes.length - 1, isFocused: false, isPlaced: true })) }))
  on('ui.scroll', () => ({}))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
}

const reply = (text: string) => ({
  plugin: 'open-file',
  component: 'AssistantMessage',
  requestId: 'm1',
  props: { text, isFirstOfReply: true },
  viewport: VIEWPORT,
}) as const

const PANE = {
  plugin: 'open-file',
  component: 'Pane',
  requestId: tabIdOf('/repo/src/app.ts'),
  props: {
    title: 'app.ts',
    isFocused: false,
    bodyColumns: 70,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
  viewport: VIEWPORT,
} as const

const hitPaths = (text: string) => findHits(text).map(h => [h.path, h.line ?? null, h.kind])

test('paths are found in prose, code spans and links, not in fences or URLs', () => {
  expect(hitPaths('See src/app.ts:12 and `README.md`.')).toEqual([
    ['src/app.ts', 12, 'plain'],
    ['README.md', null, 'code'],
  ])
  expect(hitPaths('看一下peek/hooks/register.tsx文件，还有 ~/notes/todo.txt。')).toEqual([
    ['peek/hooks/register.tsx', null, 'plain'],
    ['~/notes/todo.txt', null, 'plain'],
  ])
  expect(hitPaths('[app](src/app.ts#L3) and [site](https://x.dev/a.ts)')).toEqual([['src/app.ts', 3, 'link']])
  expect(hitPaths('https://example.com/src/app.ts is a URL')).toEqual([])
  expect(hitPaths('```\nsrc/app.ts\n```\nafter')).toEqual([])
  expect(hitPaths('version 0.4.0, 3.14, e.g, and/or')).toEqual([['e.g', null, 'plain'], ['and/or', null, 'plain']])
})

test('a file: link goes there and back', () => {
  const href = fileHref('/a b/(x)#.ts', 7)
  expect(href).toBe('file:///a%20b/%28x%29%23.ts#L7')
  expect(parseHref(href)).toEqual({ path: '/a b/(x)#.ts', line: 7 })
  expect(parseHref('file:///a b/c.ts')).toEqual({ path: '/a b/c.ts' })
  expect(resolvePath('../x/./y.ts', '/repo/sub', HOME)).toBe('/repo/x/y.ts')
  expect(resolvePath('~/y.ts', CWD, HOME)).toBe('/Users/me/y.ts')
})

test('linkify keeps the text around the links', () => {
  const text = 'Open `src/app.ts:2` or __init__.py now'
  const hits = findHits(text)
  const out = linkify(text, hits, hit => `file:///repo/${hit.path}`)
  expect(out.text).toBe('Open [`src/app.ts:2`](file:///repo/src/app.ts) or [\\_\\_init\\_\\_.py](file:///repo/__init__.py) now')
})

test('only the lines around the asked one are drawn from a big file', () => {
  const lines = Array.from({ length: 100 }, () => 'x'.repeat(9))
  expect(windowOf(lines, 50, 1000)).toEqual({ first: 0, last: 99 })
  const w = windowOf(lines, 50, 200)
  expect(w.last - w.first + 1).toBe(20)
  expect(w.first <= 49 && w.last >= 49).toBe(true)
})

test('a reply links the paths that are files, and a click opens the pane at the line', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({ ...reply('Changed src/app.ts:2, not src/gone.ts; see `README.md` and https://x.dev.'), surface: 'terminal' })
  const md = await ui.find({ type: 'Markdown' })
  expect(md?.props.text).toBe(
    'Changed [src/app.ts:2](file:///repo/src/app.ts#L2), not src/gone.ts; see [`README.md`](file:///repo/README.md) and https://x.dev.',
  )
  expect(md?.props.pressableLinks).toEqual(['file:///repo/src/app.ts#L2', 'file:///repo/README.md'])

  await ui.press({ key: 'reply-m1', link: { href: 'file:///repo/src/app.ts#L2' } })
  await ui.unmount()

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await pane.find({ type: 'Text', text: /app\.ts/ }))?.text).toBe('src/app.ts:2')
  const codes = await pane.findAll({ type: 'Code' })
  expect(codes.map(c => [c.props.source, c.props.startLine])).toEqual([
    ['line one', 1],
    ['line two', 2],
    ['line three', 3],
  ])
  expect((await pane.find({ key: 'at-1' }))?.type).toBe('Box')
  await pane.unmount()
})

test('a path in prose reads on past a space or Chinese to the file it names', () => {
  const longer = (text: string) => findHits(text).map(h => [h.path, (h.longer ?? []).map(r => [r.path, r.line ?? null])])
  expect(longer('/Users/me/Desktop/截图 2026-11-25.png')).toEqual([
    ['/Users/me/Desktop/', [['/Users/me/Desktop/截图 2026-11-25.png', null]]],
    ['2026-11-25.png', []],
  ])
  // Up to Chinese punctuation, a line number its suffix; `~/` alone starts one.
  expect(longer('看 ~/截图/a b.png:3。下一句 x/y.ts')).toEqual([
    ['~/', [['~/截图/a b.png', 3], ['~/截图/a', null]]],
    ['/a', [['/a b.png', 3]]],
    ['b.png', []],
    ['x/y.ts', []],
  ])
  // Glued to Chinese, the path alone: the longer reading names no file.
  expect(longer('看一下src/app.ts文件')).toEqual([['src/app.ts', []]])
})

test('a path with a space or Chinese in it is linked whole', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({
    ...reply('图片 /Users/me/Desktop/截图 2026-11-25.png，笔记 /repo/工作记录/配置说明.md:2。看一下src/app.ts文件，see /repo/src/app.ts and more'),
    surface: 'terminal',
  })
  const picture = fileHref('/Users/me/Desktop/截图 2026-11-25.png')
  const notes = fileHref('/repo/工作记录/配置说明.md', 2)
  expect((await ui.find({ type: 'Markdown' }))?.props.text).toBe(
    `图片 [/Users/me/Desktop/截图 2026-11-25.png](${picture})，笔记 [/repo/工作记录/配置说明.md:2](${notes})。` +
      '看一下[src/app.ts](file:///repo/src/app.ts)文件，see [/repo/src/app.ts](file:///repo/src/app.ts) and more',
  )
  await ui.press({ key: 'reply-m1', link: { href: notes } })
  await ui.unmount()
  const pane = await $.ui.mount({ ...PANE, requestId: tabIdOf('/repo/工作记录/配置说明.md'), surface: 'terminal' })
  expect((await pane.find({ type: 'Text', text: /配置说明/ }))?.text).toBe('工作记录/配置说明.md:2')
  expect((await pane.find({ key: 'at-1' }))?.type).toBe('Box')
  await pane.unmount()
})

test('a reply with no file in it, or off the fullscreen terminal, is the engine’s', async ($, on) => {
  engine(on)
  const plain = await $.ui.mount({ ...reply('Nothing here, see gone.ts.'), surface: 'terminal' })
  expect((await plain.find({ type: 'Text' }))?.text).toBe('engine')
  await plain.unmount()
  const main = await $.ui.mount({ ...reply('See src/app.ts'), surface: 'terminal', viewport: { ...VIEWPORT, isFullscreen: false } })
  expect((await main.find({ type: 'Text' }))?.text).toBe('engine')
  await main.unmount()
  const desktop = await $.ui.mount({ ...reply('See src/app.ts'), surface: 'desktop' })
  expect((await desktop.find({ type: 'Text' }))?.text).toBe('engine')
  await desktop.unmount()
})

test('a tab says so when it lost its file, and when the file is gone', async ($, on) => {
  engine(on)
  const empty = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await empty.find({ type: 'Text' }))?.text).toMatch(/再点一次路径/)
  await empty.unmount()

  const ui = await $.ui.mount({ ...reply('See ~/notes/todo.txt'), surface: 'terminal' })
  await ui.press({ key: 'reply-m1', link: { href: 'file:///Users/me/notes/todo.txt' } })
  await ui.unmount()
  delete FILES['/Users/me/notes/todo.txt']
  const pane = await $.ui.mount({ ...PANE, requestId: tabIdOf('/Users/me/notes/todo.txt'), surface: 'terminal' })
  expect((await pane.find({ type: 'Text', text: /todo/ }))?.text).toBe('~/notes/todo.txt')
  expect((await pane.find({ type: 'Text', text: /不存在/ }))?.text).toBe('文件不存在了')
  await pane.unmount()
})

test('each file opens in a tab of its own, a second click brings it back', async ($, on) => {
  const panes: Open[] = []
  engine(on, panes)
  const ui = await $.ui.mount({ ...reply('See a/index.ts, b/index.ts and src/app.ts:3'), surface: 'terminal' })
  const press = (href: string) => ui.press({ key: 'reply-m1', link: { href } })
  await press('file:///repo/a/index.ts')
  await press('file:///repo/b/index.ts')
  await press('file:///repo/src/app.ts#L3')
  await press('file:///repo/a/index.ts')
  // The file clicked again was behind another tab: it is shown, as the last.
  expect(panes).toEqual([
    { id: tabIdOf('/repo/b/index.ts'), title: 'b/index.ts' },
    { id: tabIdOf('/repo/src/app.ts'), title: 'app.ts' },
    { id: tabIdOf('/repo/a/index.ts'), title: 'index.ts' },
  ])
  await ui.unmount()

  // Each tab draws its own file; the one clicked twice counts both clicks.
  const b = await $.ui.mount({ ...PANE, requestId: tabIdOf('/repo/b/index.ts'), surface: 'terminal' })
  expect((await b.find({ type: 'Code' }))?.props.source).toBe('b')
  await b.unmount()
  const a = await $.ui.mount({ ...PANE, requestId: tabIdOf('/repo/a/index.ts'), surface: 'terminal' })
  expect((await a.find({ key: 'top-2' }))?.type).toBe('Box')
  await a.unmount()
})

test('past the most tabs, the one opened first closes', async ($, on) => {
  const panes: Open[] = []
  engine(on, panes)
  const ui = await $.ui.mount({ ...reply(Array.from({ length: 10 }, (_, i) => `f${i}.ts`).join(', ')), surface: 'terminal' })
  for (let i = 0; i < 10; i++) await ui.press({ key: 'reply-m1', link: { href: `file:///repo/f${i}.ts` } })
  await ui.unmount()
  expect(panes.map(p => p.title)).toEqual(['f2.ts', 'f3.ts', 'f4.ts', 'f5.ts', 'f6.ts', 'f7.ts', 'f8.ts', 'f9.ts'])
})

test('a tab id is the same for the same file and fits a pane id', () => {
  expect(tabIdOf('/repo/a.ts')).toBe(tabIdOf('/repo/a.ts'))
  expect(tabIdOf('/repo/a.ts')).not.toBe(tabIdOf('/repo/b.ts'))
  expect(tabIdOf('/repo/a.ts')).toMatch(/^of-[0-9a-f]{8}$/)
})
