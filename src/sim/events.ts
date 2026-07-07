// Tiny synchronous pub/sub for cross-cutting sim signals — keeps `sim/`
// from depending on `save/` and `ui/` (and vice versa). Handlers are
// invoked in the emitter's call frame so semantics match the old direct-
// call shape (e.g. emit('load:start') stops the loop before the next line
// runs; emit('toast') flushes to zustand inside the same tick).
//
// Why typed payloads? Each event name carries a different shape; a single
// `{ reason: string }` only fit the lifecycle quartet. Sim-side callers
// emit facts (a log line, a slot becoming empty, a hub being selected),
// boot/uiBindings.ts owns the translation into store calls. That keeps
// presentation decisions out of sim and lets the sim run headless.
//
// Why not a third-party emitter (mitt, eventemitter3)? ~30 LOC isn't
// worth a dep.

import type { Entity } from 'koota'
import type { FactionId } from '../config'

export interface SimEventPayloads {
  // ── Lifecycle (legacy callers — `reason` only) ───────────────────────
  'day:rollover':       { reason: string }
  // Phase 5.5.6 — fired after the day:rollover system chain settles
  // (dailyEconomics, housingPressure, recruitment). Late subscribers
  // (research, future faction-AI) hook to this so they read post-
  // rollup state. `gameDay` is the integer day number AFTER the flip.
  'day:rollover:settled': { gameDay: number }
  'hyperspeed:start':   { reason: string }
  // Phase 5.5.2 — surface from outside the loop. The loop's per-frame
  // hyperspeed gate reads `pendingHyperspeedBreak` set by this event and
  // forces isHyperspeed=false for one frame.
  'hyperspeed:break':   { reason: string }
  'load:start':         { reason: string }
  'load:end':           { reason: string }
  // ── Generic event-log + toast ────────────────────────────────────────
  'log':                { textZh: string; atMs: number }
  'toast':              { textZh: string; durationMs?: number; action?: { label: string; onClick: () => void } }
  // ── Semantic UI intents (no other way for sim to express these) ──────
  'ui:open-flight':            { hubId: string }
  'ui:open-transit':           { terminalId: string }
  'ui:open-dialog-npc':        { entity: Entity }
  'ui:open-manage':            { building: Entity }
  // Airport-style gate terminal in the drydock — opens GateTerminalPanel
  // scoped to the ship currently bound to the gate. `shipKey` is the
  // bound ship's stable EntityKey; the panel resolves it against the
  // playerShipInterior world.
  'ui:open-gate-terminal':     { gateNumber: string; shipKey: string }
  // Disembark dock picker. Fired by interactionSystem when the player
  // presses E on the disembarkShip kiosk and the docked POI advertises
  // more than one landing scene. `candidates` are valid scene ids ordered
  // as authored in pois.json5; `shipKey` is the flagship's EntityKey for
  // resolving the boarding-pad arrival on the chosen side.
  'ui:open-dock-picker':       { poiId: string; shipKey: string; candidates: string[] }
  'ui:open-captains-office':   { reason: string }
  // Phase 6.2 — captain's-office comm-panel kiosk: officer face wall
  // + named-POW intel reveal. Per-prisoner verbs land at 6.2.5; the
  // panel today is read-only.
  'ui:open-comm-panel':        { reason: string }
  // Phase 6.2 — brig walk-up kiosk: occupant list, capacity gauge.
  // Per-prisoner verbs land at 6.2.5.
  'ui:open-brig-panel':        { reason: string }
  // Phase 6.2.5.A — MS hangar terminal walk-up opens the retrofit panel
  // for the targeted MS entity.
  'ui:open-ms-retrofit':       { msKey: string }
  // Phase 6.2.E1 — war-room plot table on the flagship bridge. Renders
  // the fleet roster as drag-and-drop tokens against a formation grid;
  // sets per-ship IsInActiveFleet + formationSlot + aggression.
  'ui:open-war-room':          { reason: string }
  // Phase 6.2.E2 — flagship lifecycle hooks. Emitted from sim/navigation
  // at the same site that clears / sets the flagship's dock binding so
  // the auto-launch + auto-transit + fleet formation systems (which live
  // in src/systems/) can react via a boot-binding subscription. The
  // event keeps sim/ from reaching upward into systems/.
  'fleet:flagship-undock':     { originPoiId: string; gameDay: number }
  'fleet:flagship-dock':       { destPoiId: string }
  // W4.1 — crew live aboard the flagship. Emitted from sim/scene at the
  // board / flagship-switch sites; a systems-layer boot binding
  // (boot/crewAboardBinding.ts) calls reconcileCrewAboard() so the
  // ship-interior world re-bodies exactly the flagship's roster. Keeps
  // sim/ from reaching upward into systems/ (same pattern as fleet:*).
  'ship:crew-reconcile':       { reason: string }
  // Phase 6.1 — set the tactical-overlay visibility (combat may keep
  // running underneath while the overlay is hidden, so the player can
  // walk the ship interior mid-engagement). Subscribed by combat.ts to
  // mutate useCombatStore.open without an upward import from sim/.
  'combat:set-overlay-open': { open: boolean }
  // Phase 6.0 (left-panel loot) + Phase 6.2 (right-panel captures).
  // Fires when tactical resolves in the player's favor; the combat
  // tally panel listens.
  'ui:open-combat-tally': CombatTallyEventPayload
  // W2 Task 6 — defeat / flee debrief beat. Fires from endCombat's two
  // non-victory branches (victory keeps its own recoverables → tally path
  // above) with the deltas already computed there — no second computation
  // in the panel. A beat, not a menu: one continue button, no choices.
  'ui:open-combat-debrief': CombatDebriefEventPayload
  // W3 (ms-identity) Task 7 — the player's MS hull hit 0 (or life support
  // drained to 0) mid-sortie. The tactical auto-pauses and this event opens
  // the eject-confirm modal (a beat, not a choice — one confirm button).
  // Confirm spawns the drifting escape pod (sim/ejection.ts).
  'ui:open-eject-confirm': { titleZh: string; reasonZh: string }
  // Combat resolved while the confirm was still open (cheat/withdraw edge)
  // — close the modal so it can't confirm into a torn-down engagement.
  'ui:close-eject-confirm': { reason: string }
  // Issue #71 — recoverables dialogue. Fires at combat resolution BEFORE
  // the tally when there are survivor hulls / ejected pods to resolve.
  // The panel reads the full list via the __uclife__ / recoverables
  // surface; this event just signals "open" + a count for the smoke gate.
  'ui:open-recoverables': { hulls: number; pods: number }
  // Phase 6.3.A — colony claim panel. Fired when the player presses E on
  // the administrator's chair in an unowned colony. `poiId` identifies
  // which colony the player is attempting to claim.
  'ui:colony-claim': { poiId: string }
  // Phase 6.4.D — a canon faction's diplomat requests a meeting when its
  // standing toward the player-faction crosses the configured threshold.
  // Future newsfeed / comm consumers listen; the diplomacy registry also
  // records a pending request for the council surface to act on.
  'diplomacy:meeting-requested': { factionId: FactionId; gameDay: number }
  // Phase 7.0.B — the one-way war transition fires (UC 0079.01.03). The
  // orchestrator emits this AFTER flipping IsWartime + seeding the strategic
  // war model, so subscribers (7.0.C conscription, 7.0.D warPayoff, 7.0.E
  // civilian-war content) read a fully-wartime world. `gameDay` is the day
  // the flip landed.
  'war:transition':            { gameDay: number }
  // Phase 7.0.B — a date-keyed strategic-war event resolved against the
  // faction-strength model. Published for downstream consumers (newsfeed
  // entries, economy shocks, NPC drives). `id` is the war-events.json5 id.
  'war:event-resolved':        { id: string; gameDay: number }
  // Phase 7.0.C — a draft notice has issued to the player. The UI surfaces
  // the refusal-roll decision (accept / refuse / bribe). `refusalChance` is
  // the pre-bribe odds (0–1); `bribeCost` is the wallet cost to add the bribe
  // bonus (affordability is checked live in the panel, not snapshotted).
  'ui:draft-notice':           { refusalChance: number; bribeCost: number }
  // Phase 7.0.C — the player was drafted (refusal failed or accepted). The
  // perspective-shift routing point into Phase 7.1 wartime deployment; this
  // slice emits it, the deployment content subscribes later.
  'conscription:drafted':      { gameDay: number }
}

// Exported so systems/recoverables.ts can stash + re-emit this payload
// without an upward import from ui/. The post-combat tally panel binding
// (boot/uiBindings.ts) maps it onto the UI store.
export interface CombatTallyEventPayload {
  creditsDelta: number
  creditsAfter: number
  suppliesDelta: number
  suppliesAfter: number
  suppliesMax: number
  fuelDelta: number
  fuelAfter: number
  fuelMax: number
  // Phase 6.2 — named POWs captured this engagement.
  capturedPows: {
    id: string
    nameZh: string
    titleZh?: string
    contextZh: string
  }[]
  // Brig occupancy line shown beneath the captured list.
  brigOccupied: number
  brigCapacity: number
  // Issue #64 — MS-parts salvaged from broken-down hulls this engagement.
  salvagedParts: {
    partId: string
    kind: 'weapon' | 'frameMod'
    nameZh: string
    qty: number
  }[]
}

// W2 Task 6 — exported so uiStore + boot/uiBindings can type the store slice
// without duplicating the shape (unlike the pre-existing CombatTallyPayload/
// CombatTallyEventPayload split above).
export interface CombatDebriefEventPayload {
  outcome: 'defeat' | 'flee' | 'negotiate'
  lines: { labelZh: string; valueZh: string }[]
}

export type SimEventName = keyof SimEventPayloads

type Listener<N extends SimEventName> = (payload: SimEventPayloads[N]) => void

const listeners = new Map<SimEventName, Set<(payload: unknown) => void>>()

export function onSim<N extends SimEventName>(name: N, fn: Listener<N>): () => void {
  let set = listeners.get(name)
  if (!set) {
    set = new Set()
    listeners.set(name, set)
  }
  const wrapped = fn as (payload: unknown) => void
  set.add(wrapped)
  return () => { set!.delete(wrapped) }
}

export function emitSim<N extends SimEventName>(name: N, payload: SimEventPayloads[N]): void {
  const set = listeners.get(name)
  if (!set || set.size === 0) return
  for (const fn of set) fn(payload)
}
