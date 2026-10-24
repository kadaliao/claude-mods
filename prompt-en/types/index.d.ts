// What the mod has to say about one prompt: the English of a prompt in another
// language, or a review of a prompt written in English.
export type Translation = {
  status: 'pending' | 'done' | 'failed'
  // Absent on what an earlier version kept: a translation.
  kind?: 'translate' | 'review'
  // translate: the English. review: the prompt corrected or polished; '' when it
  // reads well, or when it was long and `fixes` lists the changes instead.
  text: string
  // review: the prompt as reviewed, pastes as labels, to mark what `text` changed.
  base?: string
  // review: errors, correct but unnatural, or nothing to change.
  verdict?: 'fix' | 'polish' | 'ok'
  // review: the main change and why, a few words.
  note?: string
  // review: other ways to say a prompt that reads well.
  alts?: string[]
  // review of a long prompt: the changes, as `"words" → "better words"`.
  fixes?: string[]
  // Why there is none: the API error kind, `empty-reply`, `unreadable-reply` or `aborted`.
  reason?: string
  // The prompt was long: a translation is its gist, a review lists fixes only.
  isCondensed?: boolean
  // Characters in the prompt as submitted, pastes included.
  sourceChars?: number
  // When the request was sent, so a call lost to a reload is not waited on forever.
  startedAt?: number
}

declare module 'claude-code' {
  interface PluginState {
    'prompt-en': {
      // One per prompt text, keyed by a hash of the text.
      byText: StateFamily<Translation | null>
      // A transcript row's id to the hash of the prompt it holds.
      byRow: StateFamily<string | null>
      isOn: boolean
    }
  }
}
