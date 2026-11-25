// Pictures in a tab: which files are pictures, their pixels set upright, and
// those pixels turned and fitted to the pane. Pure: reading the file is the
// caller's. png.ts and jpeg.ts are peek's decoders, copied: each mod installs
// on its own.

import type { ImageSource } from 'claude-code'

import { decodeJpeg } from './jpeg'
import { decodePng } from './png'
import type { Rgba } from './png'

export type { Rgba }

// The names that open as a picture. SVG is text, and opens as text.
const PICTURE_EXTS = new Set(['png', 'jpg', 'jpeg', 'jpe', 'jfif', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'heic', 'heif', 'avif', 'ico', 'icns'])
// An Image takes at most 2 MiB of pixels, and 2048 a side.
const IMAGE_BYTES = 2 * 1024 * 1024
const IMAGE_SIDE = 2048
// Pixels asked per cell: enough to look sharp on most screens.
const CELL_W = 12
const CELL_H = 24
// How much larger than its own size a small picture is drawn, its own size
// being about 8 pixels a cell.
const MOST_ZOOM = 2
// The most a decoded picture is kept at: a box this size covers any pane.
export const BASE_SIDE = 2048
const BASE_PIXELS = 4_200_000

export function isPicturePath(path: string): boolean {
  const dot = path.lastIndexOf('.')
  return dot > path.lastIndexOf('/') && PICTURE_EXTS.has(path.slice(dot + 1).toLowerCase())
}

// What the bytes are, from their first ones: the two this module decodes, or
// another the caller has converted.
export function sniff(b: Uint8Array): 'png' | 'jpeg' | 'other' {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg'
  return 'other'
}

export function base64ToBytes(s: string): Uint8Array {
  const from = (Uint8Array as unknown as { fromBase64?: (s: string) => Uint8Array }).fromBase64
  if (from !== undefined) return from(s)
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function bytesToBase64(b: Uint8Array): string {
  const to = (b as unknown as { toBase64?: () => string }).toBase64
  if (to !== undefined) return to.call(b)
  let bin = ''
  for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000))
  return btoa(bin)
}

// The EXIF orientation of a JPEG, 1 to 8; 1 (upright) where it names none.
export function exifOrientation(b: Uint8Array): number {
  if (b[0] !== 0xff || b[1] !== 0xd8) return 1
  for (let p = 2; p + 4 <= b.length; ) {
    if (b[p] !== 0xff) return 1
    const m = b[p + 1]
    if (m === 0xff) {
      p += 1
      continue
    }
    // The pixels start, or the file ends: no EXIF before them.
    if (m === 0xda || m === 0xd9) return 1
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
      p += 2
      continue
    }
    const len = (b[p + 2] << 8) | b[p + 3]
    const end = Math.min(b.length, p + 2 + len)
    // APP1 "Exif\0\0", then a TIFF header, then the first IFD's entries.
    if (m === 0xe1 && len >= 16 && b[p + 4] === 0x45 && b[p + 5] === 0x78 && b[p + 6] === 0x69 && b[p + 7] === 0x66) {
      const t = p + 10
      const isLittle = b[t] === 0x49
      const u16 = (o: number) => (isLittle ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1])
      const u32 = (o: number) => (isLittle ? u16(o) + u16(o + 2) * 0x10000 : u16(o) * 0x10000 + u16(o + 2))
      const ifd = t + u32(t + 4)
      if (ifd + 2 > end) return 1
      const count = u16(ifd)
      for (let i = 0; i < count; i++) {
        const at = ifd + 2 + i * 12
        if (at + 12 > end) break
        if (u16(at) === 0x0112) {
          const o = u16(at + 8)
          return o >= 1 && o <= 8 ? o : 1
        }
      }
      return 1
    }
    p += 2 + len
  }
  return 1
}

// What sets a picture of EXIF orientation `o` upright: mirrored left to right
// first, then turned that many quarter turns clockwise.
export function uprightOf(o: number): { turns: number; isMirrored: boolean } {
  switch (o) {
    case 2: return { turns: 0, isMirrored: true }
    case 3: return { turns: 2, isMirrored: false }
    case 4: return { turns: 2, isMirrored: true }
    case 5: return { turns: 3, isMirrored: true }
    case 6: return { turns: 1, isMirrored: false }
    case 7: return { turns: 1, isMirrored: true }
    case 8: return { turns: 3, isMirrored: false }
    default: return { turns: 0, isMirrored: false }
  }
}

// The picture mirrored left to right (if asked), then turned `turns` quarter
// turns clockwise.
export function turn(src: Rgba, turns: number, isMirrored = false): Rgba {
  const t = ((turns % 4) + 4) % 4
  if (t === 0 && !isMirrored) return src
  const { width: w, height: h } = src
  const bytes = src.data.byteOffset % 4 === 0 ? src.data : src.data.slice()
  const s = new Uint32Array(bytes.buffer, bytes.byteOffset, w * h)
  const ow = t % 2 === 0 ? w : h
  const out = new Uint32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = s[y * w + (isMirrored ? w - 1 - x : x)]
      if (t === 0) out[y * ow + x] = px
      else if (t === 1) out[x * ow + (h - 1 - y)] = px
      else if (t === 2) out[(h - 1 - y) * ow + (w - 1 - x)] = px
      else out[(w - 1 - x) * ow + y] = px
    }
  }
  return { width: ow, height: t % 2 === 0 ? h : w, data: new Uint8Array(out.buffer) }
}

// Shrinks (or, for a tiny picture, stretches) to `dw` × `dh`, each output pixel
// the alpha-weighted mean of the source pixels under it. As peek does.
export function scale(src: Rgba, dw: number, dh: number): Rgba {
  const { width: sw, height: sh, data: s } = src
  const out = new Uint8Array(dw * dh * 4)
  const xs = new Int32Array(dw + 1)
  for (let x = 0; x <= dw; x++) xs[x] = Math.min(sw, Math.floor((x * sw) / dw))
  for (let y = 0; y < dh; y++) {
    const y0 = Math.min(sh - 1, Math.floor((y * sh) / dh))
    const y1 = Math.max(y0 + 1, Math.min(sh, Math.floor(((y + 1) * sh) / dh)))
    for (let x = 0; x < dw; x++) {
      const x0 = Math.min(sw - 1, xs[x])
      const x1 = Math.max(x0 + 1, xs[x + 1])
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let yy = y0; yy < y1; yy++) {
        let i = (yy * sw + x0) * 4
        for (let xx = x0; xx < x1; xx++, i += 4) {
          const al = s[i + 3]
          r += s[i] * al
          g += s[i + 1] * al
          b += s[i + 2] * al
          a += al
        }
      }
      const o = (y * dw + x) * 4
      const n = (y1 - y0) * (x1 - x0)
      if (a > 0) {
        out[o] = Math.round(r / a)
        out[o + 1] = Math.round(g / a)
        out[o + 2] = Math.round(b / a)
      }
      out[o + 3] = Math.round(a / n)
    }
  }
  return { width: dw, height: dh, data: out }
}

// The picture no larger than `side` a side and `pixels` in all.
export function shrink(src: Rgba, side = BASE_SIDE, pixels = BASE_PIXELS): Rgba {
  const k = Math.min(1, side / src.width, side / src.height, Math.sqrt(pixels / (src.width * src.height)))
  return k < 1 ? scale(src, Math.max(1, Math.floor(src.width * k)), Math.max(1, Math.floor(src.height * k))) : src
}

// A PNG or JPEG file's pixels, upright as its EXIF says, kept no larger than a
// pane can use; its size as the person sees it (upright, before shrinking).
export function decodePicture(bytes: Uint8Array): { pixels: Rgba; width: number; height: number; format: 'PNG' | 'JPEG' } {
  const kind = sniff(bytes)
  if (kind === 'other') throw new Error('不是 PNG 或 JPEG')
  const full = kind === 'png' ? decodePng(bytes) : decodeJpeg(bytes)
  const { turns, isMirrored } = uprightOf(kind === 'jpeg' ? exifOrientation(bytes) : 1)
  const pixels = turn(shrink(full), turns, isMirrored)
  const isSideways = turns % 2 === 1
  return {
    pixels,
    width: isSideways ? full.height : full.width,
    height: isSideways ? full.width : full.height,
    format: kind === 'png' ? 'PNG' : 'JPEG',
  }
}

// The box of cells a picture of `w` × `h` pixels takes: as large as the pane's
// `maxCols` × `maxRows` lets it, a small one no more than MOST_ZOOM times its
// own size. A cell is about twice as tall as it is wide.
export function fitBox(w: number, h: number, maxCols: number, maxRows: number): { columns: number; rows: number } {
  const cols = Math.max(1, Math.min(maxCols, 255))
  const rows = Math.max(1, Math.min(maxRows, 255))
  if (w <= 0 || h <= 0) return { columns: cols, rows }
  let c = Math.min(cols, (w / 8) * MOST_ZOOM)
  let r = (c * h) / w / 2
  if (r > rows) {
    r = rows
    c = (r * 2 * w) / h
  }
  return { columns: Math.max(1, Math.min(cols, Math.round(c))), rows: Math.max(1, Math.min(rows, Math.round(r))) }
}

// What an Image draws of `pixels` turned `turns` quarter turns clockwise in a
// box of `columns` × `rows` cells: shrunk to what the box shows, then turned.
export function sourceOf(pixels: Rgba, turns: number, columns: number, rows: number): ImageSource {
  const isSideways = turns % 2 === 1
  // The box's pixels, in the picture's own orientation.
  const bw = (isSideways ? rows * CELL_H : columns * CELL_W)
  const bh = (isSideways ? columns * CELL_W : rows * CELL_H)
  const { width: w, height: h } = pixels
  const k = Math.min(1, bw / w, bh / h, IMAGE_SIDE / w, IMAGE_SIDE / h, Math.sqrt(IMAGE_BYTES / 4 / (w * h)))
  const fitted = k < 1 ? scale(pixels, Math.max(1, Math.floor(w * k)), Math.max(1, Math.floor(h * k))) : pixels
  const out = turn(fitted, turns)
  return { rgba: bytesToBase64(out.data), width: out.width, height: out.height }
}
