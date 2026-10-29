// The language the person learns: English, as before there was a choice, or Japanese.
//
// Each is a set of its own, not a parameter: what counts as a prompt in it, what the
// model is asked, and how a fix is marked differ, and are tuned per language.

export type Lang = 'en' | 'ja'

// The `language` option, as the manifest lists it.
export const langOf = (option: unknown): Lang => (option === 'japanese' ? 'ja' : 'en')

// What a language's answers and cards are kept under in the store, and their slots in
// the session's state: nothing for English, so all English kept before stays where it was.
export const nsOf = (lang: Lang): string => (lang === 'en' ? '' : `${lang}:`)

// The tag drawn before the line under a prompt.
export const labelOf = (lang: Lang): string => (lang === 'en' ? 'EN' : 'JA')

// The language's name, for the command's words, in English and in Chinese.
export const nameOf = (lang: Lang): string => (lang === 'en' ? 'English' : 'Japanese')
export const zhNameOf = (lang: Lang): string => (lang === 'en' ? '英文' : '日文')

const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/gu
const HAN = /\p{Script=Han}/gu
const count = (s: string, re: RegExp) => s.match(re)?.length ?? 0
export const countKana = (s: string) => count(s, KANA)

// Japanese, not Chinese with a stray の: a few kana, and a fair share of the letters.
export function isJapanese(s: string): boolean {
  const kana = countKana(s)
  return kana >= 2 && kana >= 0.15 * (kana + count(s, HAN))
}

// Letters of a Japanese text: kana and kanji.
export const countJapanese = (s: string) => countKana(s) + count(s, HAN)
