// Turns a picture's bytes into the source of an Image, at the size it is drawn.

import type { ImageSource } from 'claude-code'

import { decodeJpeg } from './jpeg'
import { decodePng, pngSize } from './png'
import type { Rgba } from './png'

// An Image takes at most 2 MiB of bytes, and 2048 pixels a side.
const IMAGE_BYTES = 2 * 1024 * 1024
const IMAGE_SIDE = 2048
// Pixels asked per cell for an Image: enough to look sharp on most screens.
const CELL_W = 12
const CELL_H = 24

export type Drawn =
  | { kind: 'image'; source: ImageSource; columns: number; rows: number }
  | { kind: 'none'; reason: string }

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

// The picture's size in pixels, read from its header.
export function sizeOf(mime: string, b: Uint8Array): { width: number; height: number } | undefined {
  if (mime === 'image/png') return pngSize(b)
  if (mime === 'image/gif' && b.length >= 10) return { width: b[6] | (b[7] << 8), height: b[8] | (b[9] << 8) }
  if (mime === 'image/webp' && b.length >= 30) {
    const chunk = String.fromCharCode(b[12], b[13], b[14], b[15])
    if (chunk === 'VP8 ') return { width: (b[26] | (b[27] << 8)) & 0x3fff, height: (b[28] | (b[29] << 8)) & 0x3fff }
    if (chunk === 'VP8L') {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
    }
    if (chunk === 'VP8X') {
      return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) }
    }
    return undefined
  }
  if (mime === 'image/jpeg') {
    for (let p = 2; p + 9 < b.length; ) {
      if (b[p] !== 0xff) {
        p++
        continue
      }
      const m = b[p + 1]
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { height: (b[p + 5] << 8) | b[p + 6], width: (b[p + 7] << 8) | b[p + 8] }
      }
      if (m === 0xff || m === 0x01 || (m >= 0xd0 && m <= 0xd8)) {
        p += m === 0xff ? 1 : 2
        continue
      }
      p += 2 + ((b[p + 2] << 8) | b[p + 3])
    }
  }
  return undefined
}

// The box of cells a picture of `w` × `h` pixels takes, at most `maxCols` ×
// `maxRows`; a cell is about twice as tall as it is wide.
export function fit(w: number, h: number, maxCols: number, maxRows: number): { columns: number; rows: number } {
  const cap = (n: number, max: number) => Math.max(1, Math.min(max, Math.round(n)))
  if (w <= 0 || h <= 0) return { columns: cap(maxCols, maxCols), rows: cap(maxRows, maxRows) }
  // Small pictures stay small: about 8 pixels a cell at most.
  let columns = cap(Math.min(maxCols, w / 8), maxCols)
  let rows = cap((columns * h) / w / 2, maxRows)
  if ((columns * h) / w / 2 > maxRows) columns = cap((rows * 2 * w) / h, maxCols)
  return { columns: Math.min(columns, 255), rows: Math.min(rows, 255) }
}

function decode(mime: string, b: Uint8Array): Rgba {
  if (mime === 'image/png') return decodePng(b)
  if (mime === 'image/jpeg') return decodeJpeg(b)
  throw new Error(`${mime.replace('image/', '').toUpperCase()} 还不能预览`)
}

// Shrinks (or, for a tiny picture, stretches) to `dw` × `dh`, each output pixel
// the alpha-weighted mean of the source pixels under it.
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

// Drawn results by picture and size; each costs a decode.
const cache = new Map<string, Drawn>()
let cachedChars = 0
const CACHE_CHARS = 48 * 1024 * 1024

function remember(key: string, drawn: Drawn): Drawn {
  const size = (d: Drawn) => (d.kind === 'image' && 'rgba' in d.source ? d.source.rgba.length : 0)
  cache.set(key, drawn)
  cachedChars += size(drawn)
  for (const [k, d] of cache) {
    if (cachedChars <= CACHE_CHARS || k === key) break
    cache.delete(k)
    cachedChars -= size(d)
  }
  return drawn
}

export function forget(id: string): void {
  for (const k of [...cache.keys()]) if (k.startsWith(`${id}|`)) cache.delete(k)
}

export function forgetAll(): void {
  cache.clear()
  cachedChars = 0
}

// What to draw for picture `id` (`data` its base64 bytes) in a box of
// `columns` × `rows` cells: a PNG as it is, anything larger than an Image takes
// or a JPEG decoded and shrunk to the box.
export function draw(id: string, mime: string, data: string, columns: number, rows: number): Drawn {
  const key = `${id}|${columns}x${rows}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  try {
    // A PNG not much larger than the box goes as it is; a larger one is shrunk,
    // so a thumbnail does not send the terminal the whole screenshot.
    if (mime === 'image/png' && (data.length * 3) / 4 <= IMAGE_BYTES) {
      const head = pngSize(base64ToBytes(data.slice(0, 44)))
      if (head !== undefined && head.width <= columns * CELL_W * 1.5 && head.height <= rows * CELL_H * 1.5) {
        return remember(key, { kind: 'image', source: { png: data }, columns, rows })
      }
    }
    const src = decode(mime, base64ToBytes(data))
    const k = Math.min(
      1,
      (columns * CELL_W) / src.width,
      (rows * CELL_H) / src.height,
      IMAGE_SIDE / src.width,
      IMAGE_SIDE / src.height,
      Math.sqrt(IMAGE_BYTES / 4 / (src.width * src.height)),
    )
    const px = k < 1 ? scale(src, Math.max(1, Math.floor(src.width * k)), Math.max(1, Math.floor(src.height * k))) : src
    const source: ImageSource = { rgba: bytesToBase64(px.data), width: px.width, height: px.height }
    return remember(key, { kind: 'image', source, columns, rows })
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    return remember(key, { kind: 'none', reason })
  }
}
