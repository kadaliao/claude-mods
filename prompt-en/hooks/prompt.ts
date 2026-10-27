// Reading a prompt: the person's own words, the pastes folded out of them, the
// mode it gets and the key its answer is kept under. Shared by the English under
// each prompt (register.tsx) and the vocabulary book (vocab.tsx).

// What is sent at most of the person's own words.
const MAX_PROSE = 6000
// An unfenced block this tall that reads as code (or, in a prompt in another language,
// holds no foreign letters) is pasted material.
const MATERIAL_LINES = 8
// So is a single line this long with no foreign letters and few spaces (minified JSON).
const MATERIAL_LINE_CHARS = 400
// An English prompt shorter than this many words ("ok", "commit it") is not reviewed.
const MIN_WORDS = 3

// Where an answer is kept in the store.
export const storeKey = (key: string) => `t:${key}`

// Letters outside the Latin script: Han, kana, Hangul, Cyrillic, Arabic, ...
const FOREIGN = /[^\P{L}\p{Script=Latin}]/gu
const countForeign = (s: string) => s.match(FOREIGN)?.length ?? 0
const MARKER = /\[\[M(\d+)\]\]/g

// What a host writes into the prompt for the model alone, such as the notes the desktop
// app puts before the first prompt of a session with no folder. Only a closed block counts,
// so a prompt that just mentions the tag keeps it.
const HOST_NOTE = /<system-reminder\b[^>]*>[\s\S]*?<\/system-reminder>/g

// The person's own words: the prompt with the host's notes left out. A prompt with no
// note comes back as it is, so its key, and the answer kept under it, stay the same.
export function ownWords(text: string): string {
  const own = text.replace(HOST_NOTE, '')
  return own === text ? text : own.trim()
}

// Wide East Asian letters: two terminal cells each, and 2.5 English characters of meaning.
export const WIDE =
  /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/g

const CODE_LINE =
  /^\s{2,}\S|[;{}()[\],=<>]\s*$|^\s*(\/\/|#|--|import |from |export |def |class |function |const |let |var |return |if |for |\$ |>>> |at |[\w.-]+:\d+)/

function isCodeLike(lines: string[]): boolean {
  const filled = lines.filter(l => l.trim() !== '')
  if (filled.length === 0) return false
  return filled.filter(l => CODE_LINE.test(l)).length / filled.length >= 0.5
}

export type Material = { lines: number; head: string; lang?: string }
export type Prepared = {
  // The person's own words, each pasted block replaced by a [[M<n>]] marker.
  prose: string
  materials: Material[]
  // Characters of the person's own words, markers and spacing left out.
  proseChars: number
  // The same in English characters: a wide (CJK) letter counts 2.5.
  proseWeight: number
  isCut: boolean
}

export function prepare(text: string): Prepared {
  const materials: Material[] = []
  const mark = (body: string, lang?: string) => {
    const lines = body.replace(/\s+$/, '').split('\n')
    const head = (lines.find(l => l.trim() !== '') ?? '').trim().slice(0, 80)
    materials.push(lang ? { lines: lines.length, head, lang } : { lines: lines.length, head })
    return `[[M${materials.length}]]`
  }

  // Fenced blocks, an unclosed one running to the end.
  const unfenced = text.replace(/```([\w+#.-]*)[^\n]*\n([\s\S]*?)(?:```|$)/g, (_, lang: string, body: string) =>
    mark(body, lang || undefined),
  )

  // Unfenced pastes: tall blocks of code; in a prompt in another language, tall
  // blocks with no foreign letters too (an English log or doc pasted under it).
  const isForeign = countForeign(unfenced) >= 2
  const blocks = unfenced.split(/(\n[ \t]*\n)/)
  const folded = blocks
    .map((block, i) => {
      if (i % 2 === 1 || /^\s*\[\[M\d+\]\]\s*$/.test(block)) return block
      const lines = block.split('\n')
      const foreign = countForeign(block)
      const isTall = lines.length >= MATERIAL_LINES && ((isForeign && foreign === 0) || isCodeLike(lines))
      const spaces = block.match(/\s/g)?.length ?? 0
      const isWide =
        lines.length < 3 &&
        foreign === 0 &&
        block.length >= MATERIAL_LINE_CHARS &&
        (isForeign || spaces / block.length < 0.05)
      return isTall || isWide ? mark(block) : block
    })
    .join('')
    .trim()

  const bare = folded.replace(MARKER, '').replace(/\s+/g, '')
  const proseWeight = Math.round(bare.length + 1.5 * (bare.match(WIDE)?.length ?? 0))
  const isCut = folded.length > MAX_PROSE
  return { prose: isCut ? `${folded.slice(0, MAX_PROSE)}…` : folded, materials, proseChars: bare.length, proseWeight, isCut }
}

export type Mode = 'translate' | 'review'

// What a prompt gets, judged by its own words (pastes left out): its English when
// they hold foreign letters, a review when they are English of a few words or more.
export function modeOf(text: string, prepared: Prepared = prepare(text)): Mode | null {
  const words = prepared.prose.replace(MARKER, ' ')
  if (countForeign(words) >= 2) return 'translate'
  return (words.match(/[A-Za-z][A-Za-z'’-]*/g)?.length ?? 0) >= MIN_WORDS ? 'review' : null
}

// The key a prompt's answer is kept under: the same for the row and the submission.
export function keyOf(text: string): string {
  const s = text.replace(/\s+/g, ' ').trim()
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `${(h >>> 0).toString(36)}${s.length.toString(36)}`
}

const pastedLabel = (materials: Material[], n: string) => `[pasted, ${materials[Number(n) - 1]?.lines ?? '?'} lines]`
export const withLabels = (s: string, materials: Material[]) => s.replace(MARKER, (_, n: string) => pastedLabel(materials, n))
