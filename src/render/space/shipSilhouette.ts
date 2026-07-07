// W4.6 (presentation floor) — pure class-id → silhouette mapping for the
// tactical arena. Kept renderer-agnostic (no Pixi import) so it stays
// unit-testable and cheap. The polygon families + class routing are authored
// in combat.json5 (combatConfig.shipSilhouettes); this module is the total,
// throw-free lookup the renderer calls to pick a hull shape per ship.

import { combatConfig } from '../../config'

export interface ShipShapeSpec {
  /** Resolved family name — which authored silhouette this class draws. */
  family: string
  /** Flat [x0,y0,x1,y1,…] polygon, normalized to hullRadius units, nose at +x. */
  points: number[]
}

const { fallback, byClassId, families } = combatConfig.shipSilhouettes

// Resolve once at module load: unknown/misauthored family names would leave
// a ship invisible, so fail fast at boot rather than mid-combat.
const fallbackFamily = families[fallback]
if (!fallbackFamily) {
  throw new Error(`combat.json5: shipSilhouettes.fallback "${fallback}" has no families entry`)
}
for (const [id, fam] of Object.entries(byClassId)) {
  if (!families[fam]) {
    throw new Error(`combat.json5: shipSilhouettes.byClassId["${id}"] → unknown family "${fam}"`)
  }
}

export function classShape(shipClassId: string): ShipShapeSpec {
  const family = byClassId[shipClassId] ?? fallback
  return { family, points: families[family].poly }
}
