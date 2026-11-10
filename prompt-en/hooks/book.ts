import type { EngineInterface } from 'claude-code'

import type { VocabCard } from '../types'
import { nsOf } from './lang'
import type { Lang } from './lang'

// Where the vocabulary book lies in the store, for the pane and the export alike.

// A language's cards: `v:<id>` for English, `ja:v:<id>` for Japanese.
export const prefixOf = (lang: Lang) => `${nsOf(lang)}v:`
// The cards deleted in the pane, so an export can tell the app to hide them too.
export const droppedKeyOf = (lang: Lang) => `${nsOf(lang)}vocab:dropped`
export const MAX_DROPPED = 500

export async function loadDeck($: EngineInterface, lang: Lang): Promise<VocabCard[]> {
  const keys = (await $.store.keys()).filter(k => k.startsWith(prefixOf(lang)))
  const cards: VocabCard[] = []
  for (const key of keys) {
    const card = (await $.store.get(key)) as VocabCard | undefined
    if (card && typeof card.cue === 'string' && typeof card.answer === 'string') cards.push(card)
  }
  return cards
}

// A card deleted in the pane: what an export needs to name it.
export type Dropped = Pick<VocabCard, 'id' | 'kind' | 'cue' | 'answer'>

export async function loadDropped($: EngineInterface, lang: Lang): Promise<Dropped[]> {
  const list = await $.store.get(droppedKeyOf(lang))
  return Array.isArray(list)
    ? list.filter((d): d is Dropped => typeof d?.id === 'string' && typeof d?.cue === 'string' && typeof d?.answer === 'string')
    : []
}
