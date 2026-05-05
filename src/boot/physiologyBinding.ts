// Binds the per-day physiology phase tick to the sim event bus.
// Subscribes to 'day:rollover' and runs the phase machine across every
// scene world (per-scene NPCs all carry their own conditions, and the
// design doesn't gate physiology on the active zone — colds simulate
// in inactive cells too).
//
// Same hook fans the once-per-day onset rolls (vitals saturation,
// behavior pattern). Per-action rolls (ingestion → food poisoning)
// fire from src/systems/action.ts directly so they trigger on the
// completing eat/drink action, not at midnight.

import { onSim } from '../sim/events'
import { SCENE_IDS, getWorld } from '../ecs/world'
import { useClock, gameDayNumber } from '../sim/clock'
import {
  physiologySystem, onsetCondition, rngFor, templatesForOnsetPath,
} from '../systems/physiology'
import { Vitals, Conditions, Health } from '../ecs/traits'
import type { World } from 'koota'

// Vitals saturation thresholds — physiology.md § Onset paths. Hygiene
// >= 70 sustained is the cold-trigger signal. Each player/NPC entity
// rolls once per day if the condition is met.
const HYGIENE_SATURATION = 70

function rollVitalsSaturationOnsets(world: World, day: number): void {
  for (const entity of world.query(Vitals, Conditions, Health)) {
    const h = entity.get(Health)
    if (h?.dead) continue
    const v = entity.get(Vitals)!
    if (v.hygiene < HYGIENE_SATURATION) continue
    // Walk eligible templates and roll. For Phase 4.0 the only
    // vitals_saturation template is cold_common, but the loop is
    // forward-compatible with seasonal additions.
    for (const template of templatesForOnsetPath('vitals_saturation')) {
      const rng = rngFor(entity, day, `onset:${template.id}`)
      // Daily 8% roll while saturated. Tunable per-template later by
      // moving the value into the JSON5 row.
      if (rng.uniform() >= 0.08) continue
      onsetCondition(entity, template.id, '卫生欠佳', day, rng)
      break  // One condition per saturation event per day.
    }
  }
}

let bound = false

export function bindPhysiology(): void {
  if (bound) return
  bound = true
  onSim('day:rollover', () => {
    const day = gameDayNumber(useClock.getState().gameDate)
    for (const id of SCENE_IDS) {
      const w = getWorld(id)
      // Onset rolls run before the phase tick so a fresh onset's
      // incubating phase counts the day correctly.
      rollVitalsSaturationOnsets(w, day)
      physiologySystem(w, day)
    }
  })
}
