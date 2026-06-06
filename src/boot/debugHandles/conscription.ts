// Phase 7.0.C — conscription debug handles for deterministic smoke tests.
// Force-runs the draft roll + resolution (the day:rollover:settled path the
// prod loop drives on cadence), reads the draft state, and grants the clinic
// medical letter.

import { registerDebugHandle } from '../../debug/uclifeHandle'
import { useClock, gameDayNumber } from '../../sim/clock'
import { IsPlayer } from '../../ecs/traits'
import { getWorld, SCENE_IDS } from '../../ecs/world'
import { snapshotConscription, grantMedicalLetter } from '../../sim/conscriptionState'
import {
  conscriptionRoll, resolveDraft, currentRefusalChance, type DraftChoice,
} from '../../systems/conscription'

registerDebugHandle('getConscriptionState', () => ({ ...snapshotConscription() }))

// The player's current refusal-roll odds (no bribe). Lets a test assert the
// stat-check bias deterministically (e.g. a pro-pilot ambition floors it).
registerDebugHandle('getDraftRefusalChance', () => {
  for (const sceneId of SCENE_IDS) {
    const p = getWorld(sceneId).queryFirst(IsPlayer)
    if (p) return currentRefusalChance(p, false)
  }
  return null
})

// Run the draft roll once at the current clock date (bypassing the cadence
// gate — the day-scale cadence would need many days of advance otherwise).
registerDebugHandle('forceConscriptionRoll', () => {
  const date = useClock.getState().gameDate
  return conscriptionRoll(gameDayNumber(date), date.getTime())
})

// Resolve the outstanding draft notice with the given choice (accept / refuse
// / bribe), returning the outcome.
registerDebugHandle('resolveDraft', (choice: DraftChoice) => {
  const date = useClock.getState().gameDate
  return resolveDraft(choice, gameDayNumber(date), date.getTime())
})

// Grant the player a clinic medical letter (the diegetic path is the clinic
// dialogue; this is the test-setup shortcut).
registerDebugHandle('grantMedicalLetter', () => {
  grantMedicalLetter()
  return true
})
