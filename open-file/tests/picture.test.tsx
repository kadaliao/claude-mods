import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { base64ToBytes, bytesToBase64, exifOrientation, fitBox, isPicturePath, turn, uprightOf } from '../hooks/image'
import type { Rgba } from '../hooks/image'
import { tabIdOf } from '../hooks/register'
import { JPEG, PNG } from './fixtures'

const CWD = '/repo'
const VIEWPORT = { columns: 160, rows: 40, isFullscreen: true }
const bytesOf = (s: string) => Uint8Array.from(s, c => c.charCodeAt(0))

// The JPEG with an EXIF segment naming orientation `o` right after its start.
function withOrientation(jpeg: Uint8Array, o: number): Uint8Array {
  const tiff = [0x49, 0x49, 0x2a, 0x00, 0x08, 0, 0, 0, 0x01, 0x00, 0x12, 0x01, 0x03, 0x00, 0x01, 0, 0, 0, o, 0, 0, 0, 0, 0, 0, 0]
  const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]
  const len = body.length + 2
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 0xff, ...body, ...jpeg.subarray(2)])
}

const FILES: Record<string, Uint8Array> = {
  '/repo/shot.png': base64ToBytes(PNG),
  '/repo/photo.jpg': base64ToBytes(JPEG),
  '/repo/side.jpg': withOrientation(base64ToBytes(JPEG), 6),
  '/repo/anim.gif': bytesOf('GIF89a\u0010\u0000\u0008\u0000'),
  '/repo/broken.png': bytesOf('not a picture'),
}

type Open = { id: string; title: string }
const ran = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

// Stands for the engine: a file system holding FILES, macOS's sips making a
// PNG of a GIF, and the panes the mod opened. `runs` keeps the commands run.
function engine(on: On, runs: string[][] = []) {
  const panes: Open[] = []
  on('session.cwd', () => ({ value: CWD }))
  on('env.get', (_, e) => ({ value: e.name === 'TMPDIR' ? '/tmp/' : '/Users/me' }))
  on('fs.stat', (_, e) => {
    const b = FILES[e.path]
    if (b === undefined) throw new Error(`stat ${e.path} failed: ENOENT`)
    return { value: { kind: 'file', size: b.length, mtimeMs: 1, isLink: false } }
  })
  on('fs.read', (_, e) => {
    const b = FILES[e.path]
    if (b === undefined) throw new Error(`read ${e.path} failed: ENOENT`)
    const from = e.offset ?? 0
    return { value: e.as === 'bytes' ? { base64: bytesToBase64(b.subarray(from, from + (e.length ?? b.length))) } : '' }
  })
  on('fs.exists', (_, e) => ({ value: FILES[e.path] !== undefined }))
  on('process.run', (_, e) => {
    const argv = [...e.argv]
    runs.push(argv)
    const last = argv[argv.length - 1] ?? ''
    if (argv[0] === '/bin/rm') {
      delete FILES[last]
      return ran('')
    }
    if (argv[1] === '-g') return ran(last.endsWith('.gif') ? `${last}\n  pixelWidth: 16\n  pixelHeight: 8\n` : `${last}\n  pixelWidth: <nil>\n`)
    FILES[last] = base64ToBytes(PNG)
    return ran(`${argv[argv.length - 3]}\n  ${last}\n`)
  })
  on('clock.sleep', () => ({ value: undefined }))
  on('ui.open', (_, e) => {
    if (!panes.some(p => p.id === e.id)) panes.push({ id: e.id, title: e.title ?? e.id })
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_, e) => {
    const at = panes.findIndex(p => p.id === e.id)
    if (at >= 0) panes.splice(at, 1)
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: panes.map((p, i) => ({ ...p, isShown: i === panes.length - 1, isFocused: false, isPlaced: true })) }))
  on('ui.scroll', () => ({}))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
}

const reply = (text: string) =>
  ({ plugin: 'open-file', surface: 'terminal', component: 'AssistantMessage', requestId: 'm1', props: { text, isFirstOfReply: true }, viewport: VIEWPORT }) as const

const pane = (abs: string, bodyColumns = 70, bodyRows = 30) =>
  ({
    plugin: 'open-file',
    surface: 'terminal',
    component: 'Pane',
    requestId: tabIdOf(abs),
    props: { title: 'x', isFocused: false, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows }, view: {} },
    viewport: VIEWPORT,
  }) as const

// Clicks the path in a reply, as the person would.
async function click($: Engine, path: string) {
  const ui = await $.ui.mount(reply(`See ${path}`))
  await ui.press({ key: 'reply-m1', link: { href: `file://${CWD}/${path}` } })
  await ui.unmount()
}

// The pixels of a picture `w` wide, one number each, as `turn` takes them.
function pixels(w: number, h: number, values: number[]): Rgba {
  return { width: w, height: h, data: new Uint8Array(Uint32Array.from(values).buffer) }
}
const valuesOf = (p: Rgba) => [...new Uint32Array(p.data.buffer, p.data.byteOffset, p.width * p.height)]

test('the names that open as a picture', () => {
  expect(['a/shot.PNG', 'b.jpeg', 'c.webp', 'd.heic', 'e.gif'].map(isPicturePath)).toEqual([true, true, true, true, true])
  expect(['icon.svg', 'a.png/readme', 'README', 'notes.txt'].map(isPicturePath)).toEqual([false, false, false, false])
})

test('a picture turns a quarter at a time, and mirrored', () => {
  // A B C
  // D E F
  const p = pixels(3, 2, [1, 2, 3, 4, 5, 6])
  const right = turn(p, 1)
  expect([right.width, right.height, valuesOf(right)]).toEqual([2, 3, [4, 1, 5, 2, 6, 3]])
  expect(valuesOf(turn(p, 2))).toEqual([6, 5, 4, 3, 2, 1])
  const left = turn(p, 3)
  expect([left.width, left.height, valuesOf(left)]).toEqual([2, 3, [3, 6, 2, 5, 1, 4]])
  expect(valuesOf(turn(p, 0, true))).toEqual([3, 2, 1, 6, 5, 4])
  expect(valuesOf(turn(turn(p, 1), 3))).toEqual(valuesOf(p))
  expect(turn(p, 4)).toBe(p)
})

test('a JPEG’s EXIF orientation is read, and set upright', () => {
  expect(exifOrientation(base64ToBytes(JPEG))).toBe(1)
  expect(exifOrientation(withOrientation(base64ToBytes(JPEG), 6))).toBe(6)
  expect(exifOrientation(withOrientation(base64ToBytes(JPEG), 3))).toBe(3)
  expect(exifOrientation(base64ToBytes(PNG))).toBe(1)
  expect(uprightOf(6)).toEqual({ turns: 1, isMirrored: false })
  expect(uprightOf(8)).toEqual({ turns: 3, isMirrored: false })
  expect(uprightOf(5)).toEqual({ turns: 3, isMirrored: true })
  expect(uprightOf(1)).toEqual({ turns: 0, isMirrored: false })
})

test('a picture takes as much of the pane as it can, a small one no more than twice its size', () => {
  expect(fitBox(1600, 800, 70, 26)).toEqual({ columns: 70, rows: 18 })
  expect(fitBox(800, 1600, 70, 26)).toEqual({ columns: 26, rows: 26 })
  expect(fitBox(16, 8, 70, 26)).toEqual({ columns: 4, rows: 1 })
  expect(fitBox(4000, 3000, 400, 300)).toEqual({ columns: 255, rows: 96 })
})

test('a picture opens in its tab, and the buttons turn it', async ($, on) => {
  engine(on)
  await click($, 'shot.png')
  const ui = await $.ui.mount(pane('/repo/shot.png'))
  const image = async () => (await ui.find({ type: 'Image' }))?.props
  const note = async () => (await ui.find({ type: 'Text', text: /×/ }))?.text
  expect(await image()).toMatchObject({ columns: 4, rows: 1, source: { width: 16, height: 8 }, alt: '[图片 shot.png 16×8]' })
  expect(await note()).toBe('16×8 · PNG · 226 B')
  expect(await ui.find({ key: 'turn-back' })).toBeUndefined()

  await ui.press({ key: 'turn-right' })
  expect(await image()).toMatchObject({ source: { width: 8, height: 16 } })
  expect(await note()).toBe('16×8 · PNG · 226 B · 向右转了 90°')
  await ui.press({ key: 'turn-right' })
  await ui.press({ key: 'turn-right' })
  expect(await note()).toMatch(/向左转了 90°$/)
  await ui.press({ key: 'turn-right' })
  expect(await note()).toBe('16×8 · PNG · 226 B')

  await ui.press({ key: 'turn-left' })
  expect(await note()).toMatch(/向左转了 90°$/)
  await ui.unmount()

  // Clicked again, it keeps its turn; 还原 sets it back.
  await click($, 'shot.png')
  const again = await $.ui.mount(pane('/repo/shot.png'))
  expect((await again.find({ type: 'Image' }))?.props).toMatchObject({ source: { width: 8, height: 16 } })
  await again.press({ key: 'turn-back' })
  expect((await again.find({ type: 'Image' }))?.props).toMatchObject({ source: { width: 16, height: 8 } })
  expect(await again.find({ key: 'turn-back' })).toBeUndefined()
  await again.unmount()
})

test('a photo is set upright as its EXIF says, and a JPEG drawn as a JPEG', async ($, on) => {
  engine(on)
  await click($, 'side.jpg')
  const side = await $.ui.mount(pane('/repo/side.jpg'))
  expect((await side.find({ type: 'Image' }))?.props).toMatchObject({ source: { width: 8, height: 16 } })
  expect((await side.find({ type: 'Text', text: /×/ }))?.text).toMatch(/^8×16 · JPEG · /)
  await side.unmount()

  await click($, 'photo.jpg')
  const photo = await $.ui.mount(pane('/repo/photo.jpg'))
  expect((await photo.find({ type: 'Image' }))?.props).toMatchObject({ source: { width: 16, height: 8 } })
  await photo.unmount()
})

test('a GIF is turned into a PNG by sips, and the PNG it wrote removed', async ($, on) => {
  const runs: string[][] = []
  engine(on, runs)
  await click($, 'anim.gif')
  const ui = await $.ui.mount(pane('/repo/anim.gif'))
  expect((await ui.find({ type: 'Image' }))?.props).toMatchObject({ source: { width: 16, height: 8 } })
  expect((await ui.find({ type: 'Text', text: /×/ }))?.text).toMatch(/^16×8 · GIF · /)
  await ui.unmount()
  const tmp = `/tmp/open-file-${tabIdOf('/repo/anim.gif')}-1.png`
  expect(runs).toEqual([
    ['/usr/bin/sips', '-g', 'pixelWidth', '-g', 'pixelHeight', '/repo/anim.gif'],
    ['/usr/bin/sips', '-s', 'format', 'png', '/repo/anim.gif', '--out', tmp],
    ['/bin/rm', '-f', tmp],
  ])
  expect(FILES[tmp]).toBeUndefined()
})

test('a file named as a picture that is none says so', async ($, on) => {
  engine(on)
  await click($, 'broken.png')
  const ui = await $.ui.mount(pane('/repo/broken.png'))
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /显示不了/ }))?.text).toBe('显示不了这张图片：读不出这张图片')
  await ui.unmount()
})
