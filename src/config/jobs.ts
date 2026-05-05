import json5 from 'json5'
import raw from './jobs.json5?raw'
import type { SkillId } from './skills'
import type { FactionId } from './factions'

// Career-ladder gate: hire into this rank requires `min` rep toward
// `faction`.
export interface FactionRepReq {
  faction: FactionId
  min: number
}

// Hire requires `minOpinion` toward at least one entity carrying
// FactionRole({faction, role}) in the world.
export interface RelationReq {
  faction: FactionId
  role: 'staff' | 'manager' | 'board'
  minOpinion: number
}

// `family`/`rank`/`employer` mark a spec as part of a faction career ladder:
// faction-specific conversation panels group specs by family and walk the
// player up the rank, while the city-wide HR hides them.
export interface JobSpec {
  jobTitle: string
  wage: number
  skillXp: number
  skill: SkillId | null
  shiftStart: number
  shiftEnd: number
  workDays: number[]
  requirements: Partial<Record<SkillId, number>>
  description: string
  playerHireable: boolean
  family?: string
  rank?: number
  employer?: FactionId
  repReq?: FactionRepReq
  relationReq?: RelationReq
}

export interface JobsConfig {
  catalog: Record<string, JobSpec>
}

export const jobsConfig = json5.parse(raw) as JobsConfig
