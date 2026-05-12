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
  rollEnvironmentalOnsets,
} from '../systems/physiology'
import { contagionAggregateSystem } from '../systems/contagion'
import { Vitals, Conditions, Health } from '../ecs/traits'
import { physiologyConfig } from '../config'
import type { World } from 'koota'

function rollVitalsSaturationOnsets(world: World, day: number): void {
  const gate = physiologyConfig.hygieneSaturation
  const roll = physiologyConfig.vitalsSaturationDailyRoll
  for (const entity of world.query(Vitals, Conditions, Health)) {
    const h = entity.get(Health)
    if (h?.dead) continue
    const v = entity.get(Vitals)!
    if (v.hygiene < gate) continue
    for (const template of templatesForOnsetPath('vitals_saturation')) {
      const rng = rngFor(entity, day, `onset:${template.id}`)
      if (rng.uniform() >= roll) continue
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
      rollEnvironmentalOnsets(w, day)
      // Phase 4.2 — inactive-zone aggregate SIR: every non-Active living
      // character in this scene rolls one transmission chance scaled by
      // current prevalence. Active characters are handled per-tick by
      // contagionSystem (sim/loop.ts).
      contagionAggregateSystem(w, day, id)
      physiologySystem(w, day)
    }
  })
}
