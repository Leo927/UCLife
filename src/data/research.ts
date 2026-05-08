import json5 from 'json5'
import raw from './research.json5?raw'

// Effect rows on a research entry. The statId / type strings are
// validated against FactionStatId / ModType at the consumer seam
// (src/systems/research.ts) — kept as plain strings here so the data
// layer doesn't reach upward into src/stats/.
export interface ResearchEffectRow {
  statId: string
  type: string
  value: number
}

export interface ResearchSpec {
  id: string
  nameZh: string
  descZh: string
  flavorZh?: string
  cost: number
  prereqs: string[]
  effects: ResearchEffectRow[]
  unlocks: string[]
  category: string
  significant: boolean
}

interface ResearchCatalogFile {
  catalog: Record<string, Omit<ResearchSpec, 'id'>>
}

const file = json5.parse(raw) as ResearchCatalogFile

const byId: Record<string, ResearchSpec> = {}
for (const [id, row] of Object.entries(file.catalog)) {
  byId[id] = { id, ...row }
}

export const researchCatalog: readonly ResearchSpec[] = Object.values(byId)

export function getResearchSpec(id: string): ResearchSpec | null {
  return byId[id] ?? null
}
