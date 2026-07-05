// Translates sim events into UI-store calls. Sibling to autosaveBinding.ts;
// together these subscribers keep `sim/` and `systems/` from importing
// anything under `src/ui/` so the simulator can run headless (smoke tests,
// future server-side validation, etc.).
//
// Every binding here is a one-liner: read the typed payload off the event,
// call the corresponding zustand store action. The "why an event, not a
// direct call?" answer is the import direction — sim emits a fact, ui
// owns the presentation decision.

import { onSim } from '../sim/events'
import { useUI } from '../ui/uiStore'
import { useEventLog } from '../ui/EventLog'

let bound = false

export function bindUi(): void {
  if (bound) return
  bound = true

  onSim('log', ({ textZh, atMs }) => {
    useEventLog.getState().push(textZh, atMs)
  })
  onSim('toast', ({ textZh, durationMs, action }) => {
    useUI.getState().showToast(textZh, durationMs, action)
  })
  onSim('ui:open-flight', ({ hubId }) => useUI.getState().openFlight(hubId))
  onSim('ui:open-transit', ({ terminalId }) => useUI.getState().openTransit(terminalId))
  onSim('ui:open-dialog-npc', ({ entity }) => useUI.getState().setDialogNPC(entity))
  onSim('ui:open-manage', ({ building }) => useUI.getState().setDialogManageBuilding(building))
  onSim('ui:open-gate-terminal', ({ gateNumber, shipKey }) =>
    useUI.getState().openGateTerminal({ gateNumber, shipKey }),
  )
  onSim('ui:open-dock-picker', (payload) =>
    useUI.getState().openDockPicker(payload),
  )
  onSim('ui:open-captains-office', () => useUI.getState().setCaptainsOffice(true))
  onSim('ui:open-comm-panel', () => useUI.getState().setCommPanel(true))
  onSim('ui:open-brig-panel', () => useUI.getState().setBrigPanel(true))
  onSim('ui:open-war-room', () => useUI.getState().setWarRoom(true))
  onSim('ui:open-ms-retrofit', ({ msKey }) => useUI.getState().setMsRetrofit(msKey))
  onSim('ui:open-combat-tally', (t) => useUI.getState().setCombatTally(t))
  // W2 Task 6 — defeat / flee debrief beat.
  onSim('ui:open-combat-debrief', (d) => useUI.getState().setCombatDebrief(d))
  // Issue #71 — recoverables dialogue opens before the tally.
  onSim('ui:open-recoverables', () => useUI.getState().setRecoverables(true))
  // Phase 6.3.A — colony claim panel.
  onSim('ui:colony-claim', ({ poiId }) => useUI.getState().setColonyClaimPoiId(poiId))
  // Phase 7.0.C — conscription draft-notice panel.
  onSim('ui:draft-notice', (payload) => useUI.getState().setDraftNotice(payload))
}
