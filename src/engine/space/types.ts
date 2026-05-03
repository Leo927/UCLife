// Pure-engine types for the continuous-space sim. The engine deliberately
// re-declares a minimal OrbitalParams instead of importing the data-file
// shape so it stays usable on its own.

export interface Vec2 {
  x: number
  y: number
}

export interface OrbitalParams {
  parentId: string | null
  pos?: Vec2
  orbitRadius?: number
  orbitPeriodDays?: number
  orbitPhase?: number
}

export type ParentResolver = (id: string) => OrbitalParams | undefined
