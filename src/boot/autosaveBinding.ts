// Wires autosave to sim events. Replaces the loop's old in-line
// `tryAutosave` — same throttle + in-flight semantics, but the sim
// layer no longer needs to import `save`. Triggers:
//   - day:rollover     ("日翻页")     — once per game-day boundary
//   - hyperspeed:start ("快进开始")    — leading edge of a committed action
//
// Throttled by timeConfig.autosaveCooldownRealSec so back-to-back triggers
// (e.g. day rollover landing inside a hyperspeed sleep) collapse to one
// write.

import { saveGame } from '../save'
import { onSim } from '../sim/events'
import { useUI } from '../ui/uiStore'
import { timeConfig } from '../config'

const COOLDOWN_MS = timeConfig.autosaveCooldownRealSec * 1000

let lastAtMs = 0
let inFlight = false

function tryAutosave(reason: string): void {
  const now = performance.now()
  if (inFlight) return
  if (now - lastAtMs < COOLDOWN_MS) return
  inFlight = true
  lastAtMs = now
  saveGame('auto')
    .catch((e: unknown) => {
      useUI.getState().showToast(`自动保存失败 (${reason}): ${(e as Error).message}`, 6000)
    })
    .finally(() => { inFlight = false })
}

let bound = false

export function bindAutosave(): void {
  if (bound) return
  bound = true
  onSim('day:rollover', (e) => tryAutosave(e.reason || '日翻页'))
  onSim('hyperspeed:start', (e) => tryAutosave(e.reason || '快进开始'))
}
