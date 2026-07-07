// W4.1 — crew-aboard persistence. Crew bodies live in the ship-interior
// world (`playerShipInterior`), not the active-scene world the entity
// snapshot loop captures, so — exactly like the ship + MS handlers — this
// reads that world directly and round-trips each crew body's identity
// (name, appearance, attributes/skills, hire markers). On restore it
// re-materializes the bodies, then reconciles every ship's roster so the
// world holds exactly the persisted roster with no orphan/duplicate.
//
// Registered AFTER `./ship` so `reconcileAllCrewAboard` sees the restored
// Ship.crewIds / assignedCaptainId rosters.

import { registerSaveHandler } from '../../save/registry'
import { getWorld, type SceneId } from '../../ecs/world'
import {
  Character, EmployedAsCrew, EntityKey, Position, Appearance, Attributes,
} from '../../ecs/traits'
import type { Gender } from '../../ecs/traits'
import { spawnNPC } from '../../character/spawn'
import { reconcileCrewAboard } from '../../systems/crewAboard'
import {
  serializeSheet, attachFormulas, type SerializedSheet,
} from '../../stats/sheet'
import { STAT_IDS, STAT_FORMULAS, type StatId } from '../../stats/schema'

const SHIP_SCENE_ID: SceneId = 'playerShipInterior'
const CREW_KEY_PREFIX = 'npc-crew-'

interface CrewBodySnap {
  key: string
  role: 'captain' | 'crew'
  shipKey: string
  name: string
  color: string
  title: string
  x: number
  y: number
  gender: Gender
  appearance: AppearanceSnap
  sheet: SerializedSheet<StatId>
}

// The Appearance trait's data shape (koota doesn't export the inferred
// value type, so we mirror the fields we persist). Stored/restored whole.
type AppearanceSnap = Parameters<typeof Appearance>[0]

interface CrewAboardBlock {
  bodies: CrewBodySnap[]
}

function snapshotCrewAboard(): CrewAboardBlock | undefined {
  const w = getWorld(SHIP_SCENE_ID)
  const bodies: CrewBodySnap[] = []
  for (const e of w.query(Character, EmployedAsCrew, EntityKey)) {
    const key = e.get(EntityKey)!.key
    if (!key.startsWith(CREW_KEY_PREFIX)) continue
    const ch = e.get(Character)!
    const emp = e.get(EmployedAsCrew)!
    const pos = e.get(Position)
    // spawnNPC always attaches Appearance + Attributes, so crew bodies
    // always carry both.
    const app = e.get(Appearance)!
    const attrs = e.get(Attributes)!
    bodies.push({
      key,
      role: emp.role,
      shipKey: emp.shipKey,
      name: ch.name,
      color: ch.color,
      title: ch.title,
      x: pos?.x ?? 0,
      y: pos?.y ?? 0,
      gender: app.gender,
      appearance: { ...app },
      sheet: serializeSheet(attrs.sheet),
    })
  }
  if (bodies.length === 0) return undefined
  return { bodies }
}

function restoreCrewAboard(block: CrewAboardBlock): void {
  const w = getWorld(SHIP_SCENE_ID)
  const byKey = new Map<string, ReturnType<typeof w.queryFirst>>()
  for (const e of w.query(EntityKey)) byKey.set(e.get(EntityKey)!.key, e)

  for (const b of block.bodies) {
    let ent = byKey.get(b.key)
    if (!ent) {
      ent = spawnNPC(w, {
        name: b.name, color: b.color, title: b.title,
        x: b.x, y: b.y, key: b.key, gender: b.gender,
      })
      byKey.set(b.key, ent)
    }
    if (ent.has(Character)) ent.set(Character, { name: b.name, color: b.color, title: b.title })
    if (ent.has(Appearance)) ent.set(Appearance, { ...b.appearance })
    if (ent.has(Attributes)) {
      const a = ent.get(Attributes)!
      ent.set(Attributes, { ...a, sheet: attachFormulas(STAT_IDS, STAT_FORMULAS, b.sheet) })
    }
    if (ent.has(EmployedAsCrew)) ent.set(EmployedAsCrew, { shipKey: b.shipKey, role: b.role })
    else ent.add(EmployedAsCrew({ shipKey: b.shipKey, role: b.role }))
  }

  // Align the interior to the restored flagship roster (trims any body no
  // longer rostered, spawns any roster entry with no snap).
  reconcileCrewAboard()
}

registerSaveHandler<CrewAboardBlock>({
  id: 'crewAboard',
  snapshot: snapshotCrewAboard,
  restore: restoreCrewAboard,
  // No reset() — resetWorld() already clears the ship world, and a New
  // Game has no crew aboard until the player hires some.
})
