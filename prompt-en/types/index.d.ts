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

// One entry of the vocabulary book: something the person said, or could not yet say,
// and the English to learn for it.
export type VocabCard = {
  // A hash of what it teaches, so the same correction or phrase is kept once.
  id: string
  // fix: a review corrected or polished the person's English. phrase: an expression
  // the English of a prompt in another language uses. pattern: a sentence of that
  // English whose frame can be reused.
  kind: 'fix' | 'phrase' | 'pattern'
  // What the card shows first. fix: the person's words; phrase and pattern: their
  // own-language words, a pattern's a whole sentence.
  cue: string
  // What they recall: the better English, or the English expression.
  answer: string
  // fix: the kind of change and why, a few words ("article").
  why?: string
  // pattern: the frame, its changing parts as ___ ("Hold off on ___ until ___").
  pattern?: string
  // The sentence of the prompt it came from that holds the cue (a pattern's, with the
  // sentences either side), cut short around it. Before 0.3.1, the prompt's start.
  context?: string
  // The sentence that holds the answer, cut short around it. fix: of the prompt
  // corrected; phrase: of the English it appeared in.
  example?: string
  addedAt: number
  // How many times it was collected: a fix made again counts.
  seen: number
  // Leitner box, 0 (new or forgotten) up; each box waits longer before it is due.
  box: number
  due: number
  lapses: number
}

export type Grade = 'again' | 'hard' | 'good'

// One sitting of review in the pane.
export type Quiz = {
  // The cards of this sitting, in order, as they stood when it began.
  cards: VocabCard[]
  index: number
  isRevealed: boolean
  tally: Record<Grade, number>
  // Cards in the book when it began.
  deckSize: number
  // When the next card is due once none is, for the screen with nothing to review.
  nextDue?: number
}

declare module 'claude-code' {
  interface PluginState {
    'prompt-en': {
      // One per prompt text, keyed by a hash of the text.
      byText: StateFamily<Translation | null>
      // A transcript row's id to the hash of the prompt it holds.
      byRow: StateFamily<string | null>
      isOn: boolean
      quiz: Shaped<Quiz | null>
    }
  }
}
