// A PNG decoder with its own inflate, since a mod has no zlib: every colour type
// and bit depth, palettes and tRNS, and Adam7 interlacing. Output is 8-bit RGBA.

export type Rgba = { width: number; height: number; data: Uint8Array }

// ---- inflate (RFC 1950 zlib wrapper around RFC 1951 deflate) ----

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]

// A lookup table indexed by the next `bits` input bits: each entry is
// `symbol << 4 | code length`, 0 where no code matches.
type Table = { table: Uint32Array; bits: number }

function buildTable(lengths: ArrayLike<number>, n: number): Table {
  let max = 0
  for (let i = 0; i < n; i++) if (lengths[i] > max) max = lengths[i]
  const table = new Uint32Array(1 << max)
  if (max === 0) return { table, bits: 0 }
  const count = new Uint16Array(16)
  for (let i = 0; i < n; i++) count[lengths[i]]++
  count[0] = 0
  const next = new Uint16Array(16)
  let code = 0
  for (let len = 1; len <= 15; len++) {
    code = (code + count[len - 1]) << 1
    next[len] = code
  }
  for (let sym = 0; sym < n; sym++) {
    const len = lengths[sym]
    if (len === 0) continue
    const c = next[len]++
    // Deflate sends codes most significant bit first; the reader takes bits
    // least significant first, so the table is indexed by the reversed code.
    let r = 0
    for (let k = 0; k < len; k++) r |= ((c >> k) & 1) << (len - 1 - k)
    for (let j = r; j < table.length; j += 1 << len) table[j] = (sym << 4) | len
  }
  return { table, bits: max }
}

let fixedLit: Table | undefined
let fixedDist: Table | undefined

function fixedTables(): [Table, Table] {
  if (fixedLit === undefined || fixedDist === undefined) {
    const lit = new Uint8Array(288)
    lit.fill(8, 0, 144)
    lit.fill(9, 144, 256)
    lit.fill(7, 256, 280)
    lit.fill(8, 280, 288)
    fixedLit = buildTable(lit, 288)
    fixedDist = buildTable(new Uint8Array(30).fill(5), 30)
  }
  return [fixedLit, fixedDist]
}

// Inflates a zlib stream. `sizeHint` is the expected output size (the buffer
// grows past it if the stream holds more).
export function inflate(data: Uint8Array, sizeHint: number): Uint8Array {
  if (data.length < 2 || (data[0] & 0x0f) !== 8) throw new Error('not a zlib stream')
  if (data[1] & 0x20) throw new Error('zlib preset dictionary')
  let pos = 2
  let buf = 0
  let cnt = 0
  let out = new Uint8Array(Math.max(1024, sizeHint))
  let op = 0

  const need = (n: number) => {
    while (cnt < n) {
      buf |= (pos < data.length ? data[pos] : 0) << cnt
      pos++
      cnt += 8
    }
  }
  const bits = (n: number) => {
    if (n === 0) return 0
    need(n)
    const v = buf & ((1 << n) - 1)
    buf >>>= n
    cnt -= n
    return v
  }
  const symbol = (t: Table) => {
    need(t.bits)
    const entry = t.table[buf & ((1 << t.bits) - 1)]
    const len = entry & 15
    if (len === 0) throw new Error('bad huffman code')
    buf >>>= len
    cnt -= len
    return entry >>> 4
  }
  const room = (n: number) => {
    if (op + n <= out.length) return
    let size = out.length * 2
    while (size < op + n) size *= 2
    const grown = new Uint8Array(size)
    grown.set(out.subarray(0, op))
    out = grown
  }

  let isFinal = 0
  while (!isFinal) {
    if (pos > data.length + 4) throw new Error('truncated deflate stream')
    isFinal = bits(1)
    const type = bits(2)
    if (type === 0) {
      // Stored: drop the bits left of this byte, and give back whole bytes read ahead.
      bits(cnt & 7)
      pos -= cnt >> 3
      buf = 0
      cnt = 0
      if (pos + 4 > data.length) throw new Error('truncated stored block')
      const len = data[pos] | (data[pos + 1] << 8)
      pos += 4
      if (pos + len > data.length) throw new Error('truncated stored block')
      room(len)
      out.set(data.subarray(pos, pos + len), op)
      op += len
      pos += len
      continue
    }
    let lit: Table
    let dist: Table
    if (type === 1) {
      ;[lit, dist] = fixedTables()
    } else if (type === 2) {
      const hlit = bits(5) + 257
      const hdist = bits(5) + 1
      const hclen = bits(4) + 4
      const cl = new Uint8Array(19)
      for (let i = 0; i < hclen; i++) cl[CL_ORDER[i]] = bits(3)
      const clTable = buildTable(cl, 19)
      const lengths = new Uint8Array(hlit + hdist)
      for (let i = 0; i < hlit + hdist; ) {
        const sym = symbol(clTable)
        if (sym < 16) {
          lengths[i++] = sym
        } else {
          let repeat: number
          let value = 0
          if (sym === 16) {
            if (i === 0) throw new Error('repeat with no length')
            value = lengths[i - 1]
            repeat = 3 + bits(2)
          } else if (sym === 17) {
            repeat = 3 + bits(3)
          } else {
            repeat = 11 + bits(7)
          }
          if (i + repeat > lengths.length) throw new Error('code lengths overrun')
          lengths.fill(value, i, i + repeat)
          i += repeat
        }
      }
      lit = buildTable(lengths.subarray(0, hlit), hlit)
      dist = buildTable(lengths.subarray(hlit), hdist)
    } else {
      throw new Error('bad block type')
    }
    for (;;) {
      const sym = symbol(lit)
      if (sym < 256) {
        room(1)
        out[op++] = sym
      } else if (sym === 256) {
        break
      } else {
        const li = sym - 257
        if (li >= 29) throw new Error('bad length code')
        const len = LEN_BASE[li] + bits(LEN_EXTRA[li])
        const di = symbol(dist)
        if (di >= 30) throw new Error('bad distance code')
        const d = DIST_BASE[di] + bits(DIST_EXTRA[di])
        if (d > op) throw new Error('distance past the start')
        room(len)
        for (let k = 0; k < len; k++, op++) out[op] = out[op - d]
      }
    }
  }
  return op === out.length ? out : out.subarray(0, op)
}

// ---- PNG ----

const ADAM7 = [
  // x start, y start, x step, y step
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
]

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

function u32(b: Uint8Array, i: number): number {
  return ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0
}

export function pngSize(b: Uint8Array): { width: number; height: number } | undefined {
  if (b.length < 24 || b[0] !== 0x89 || b[1] !== 0x50 || b[2] !== 0x4e || b[3] !== 0x47) return undefined
  return { width: u32(b, 16), height: u32(b, 20) }
}

export function decodePng(b: Uint8Array): Rgba {
  if (pngSize(b) === undefined) throw new Error('not a PNG')
  let width = 0
  let height = 0
  let depth = 0
  let colorType = 0
  let interlace = 0
  let palette: Uint8Array | undefined
  let trns: Uint8Array | undefined
  const idat: Uint8Array[] = []
  let idatLength = 0
  for (let p = 8; p + 8 <= b.length; ) {
    const len = u32(b, p)
    const type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7])
    const body = b.subarray(p + 8, p + 8 + len)
    if (type === 'IHDR') {
      width = u32(body, 0)
      height = u32(body, 4)
      depth = body[8]
      colorType = body[9]
      interlace = body[12]
    } else if (type === 'PLTE') {
      palette = body
    } else if (type === 'tRNS') {
      trns = body
    } else if (type === 'IDAT') {
      idat.push(body)
      idatLength += body.length
    } else if (type === 'IEND') {
      break
    }
    p += 12 + len
  }
  const channels = CHANNELS[colorType]
  if (channels === undefined || width === 0 || height === 0) throw new Error('bad PNG header')
  if (width * height > 50_000_000) throw new Error('PNG too large')
  const z = new Uint8Array(idatLength)
  let zp = 0
  for (const part of idat) {
    z.set(part, zp)
    zp += part.length
  }

  const bitsPerPixel = channels * depth
  const step = Math.max(1, bitsPerPixel >> 3)
  const passes =
    interlace === 1
      ? ADAM7.map(([x0, y0, dx, dy]) => ({
          x0,
          y0,
          dx,
          dy,
          w: width > x0 ? Math.ceil((width - x0) / dx) : 0,
          h: height > y0 ? Math.ceil((height - y0) / dy) : 0,
        }))
      : [{ x0: 0, y0: 0, dx: 1, dy: 1, w: width, h: height }]
  let rawSize = 0
  for (const pass of passes) if (pass.w > 0 && pass.h > 0) rawSize += pass.h * (1 + Math.ceil((pass.w * bitsPerPixel) / 8))
  const raw = inflate(z, rawSize)
  if (raw.length < rawSize) throw new Error('PNG data ends early')

  const out = new Uint8Array(width * height * 4)
  const max = (1 << depth) - 1
  // A tRNS key colour for grey and RGB images, in the image's own sample values.
  const key =
    trns === undefined || colorType === 3
      ? undefined
      : colorType === 0
        ? [(trns[0] << 8) | trns[1]]
        : [(trns[0] << 8) | trns[1], (trns[2] << 8) | trns[3], (trns[4] << 8) | trns[5]]

  let rp = 0
  for (const pass of passes) {
    if (pass.w === 0 || pass.h === 0) continue
    const rowBytes = Math.ceil((pass.w * bitsPerPixel) / 8)
    let prev = -1
    for (let y = 0; y < pass.h; y++) {
      const filter = raw[rp]
      const row = rp + 1
      unfilter(raw, filter, row, prev, rowBytes, step)
      // One sample of this row, as stored (up to 16 bits).
      const sample = (i: number): number => {
        if (depth === 8) return raw[row + i]
        if (depth === 16) return (raw[row + 2 * i] << 8) | raw[row + 2 * i + 1]
        const bit = i * depth
        return (raw[row + (bit >> 3)] >> (8 - depth - (bit & 7))) & max
      }
      const to8 = (v: number): number => (depth === 16 ? v >> 8 : depth === 8 ? v : Math.round((v * 255) / max))
      const oy = pass.y0 + y * pass.dy
      for (let x = 0; x < pass.w; x++) {
        const o = (oy * width + pass.x0 + x * pass.dx) * 4
        const s = x * channels
        if (colorType === 3) {
          const idx = sample(s)
          out[o] = palette ? palette[idx * 3] : 0
          out[o + 1] = palette ? palette[idx * 3 + 1] : 0
          out[o + 2] = palette ? palette[idx * 3 + 2] : 0
          out[o + 3] = trns !== undefined && idx < trns.length ? trns[idx] : 255
        } else if (colorType === 0 || colorType === 4) {
          const g = sample(s)
          const v = to8(g)
          out[o] = out[o + 1] = out[o + 2] = v
          out[o + 3] = colorType === 4 ? to8(sample(s + 1)) : key !== undefined && g === key[0] ? 0 : 255
        } else {
          const r = sample(s)
          const g = sample(s + 1)
          const bl = sample(s + 2)
          out[o] = to8(r)
          out[o + 1] = to8(g)
          out[o + 2] = to8(bl)
          out[o + 3] =
            colorType === 6 ? to8(sample(s + 3)) : key !== undefined && r === key[0] && g === key[1] && bl === key[2] ? 0 : 255
        }
      }
      prev = row
      rp = row + rowBytes
    }
  }
  return { width, height, data: out }
}

// Undoes one row's filter in place; `prev` is the previous row's start in the
// same buffer, or -1 for the first row of a pass.
function unfilter(b: Uint8Array, filter: number, row: number, prev: number, len: number, step: number): void {
  switch (filter) {
    case 0:
      return
    case 1:
      for (let i = step; i < len; i++) b[row + i] = (b[row + i] + b[row + i - step]) & 255
      return
    case 2:
      if (prev < 0) return
      for (let i = 0; i < len; i++) b[row + i] = (b[row + i] + b[prev + i]) & 255
      return
    case 3:
      for (let i = 0; i < len; i++) {
        const left = i >= step ? b[row + i - step] : 0
        const up = prev >= 0 ? b[prev + i] : 0
        b[row + i] = (b[row + i] + ((left + up) >> 1)) & 255
      }
      return
    case 4:
      for (let i = 0; i < len; i++) {
        const a = i >= step ? b[row + i - step] : 0
        const up = prev >= 0 ? b[prev + i] : 0
        const c = i >= step && prev >= 0 ? b[prev + i - step] : 0
        const p = a + up - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - up)
        const pc = Math.abs(p - c)
        const pred = pa <= pb && pa <= pc ? a : pb <= pc ? up : c
        b[row + i] = (b[row + i] + pred) & 255
      }
      return
    default:
      throw new Error(`bad PNG filter ${filter}`)
  }
}
