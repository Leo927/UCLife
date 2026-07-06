// W3 (ms-identity) Task 7 — ejection with stakes.
//
// Owns the transient escape-pod state for a tactical engagement. A pod is
// spawned when an MS hull hits 0 (or the pilot's life support drains to 0):
// the pilot ejects into a small, unpowered capsule that DRIFTS at a fraction
// of the MS's last velocity. Pods are deliberately NOT CombatShipState rows —
// enemy weapon/target scans filter to `side==='player'` (and player fire
// scans `side==='enemy'`), so a pod is never shot at. It can only be lost by
// a hostile MS/ship maneuvering onto it (hostile-reach capture).
//
// This module is PURE state + seeded ROLLS + resolution DECISIONS. It does
// not touch physiology, Health, scene placement, or the combat log — those
// are systems-layer effects applied by the callers (systems/combat.ts,
// systems/msWings.ts), because src/sim/ must not import src/systems/
// (dependency-cruiser `no-up-from-sim-or-ai`). ejection.ts decides the fate;
// the caller enacts it.
//
// Perf (CLAUDE.md): the only per-tick work is tickPodDrift (O(P), P = live
// pods, realistically ≤ hangar capacity) and checkHostileReachCaptures
// (O(P × H), H = hostiles) — one nearest-hostile distance scan per pod, the
// same shape every combat unit already runs. P and H are both single digits
// in a normal engagement; no new full-world scan.

import { sortieConfig } from '../config'
import { getSimRng } from './rng'
import { isPermadeathEnabled } from './permadeath'

export interface Pod {
  kind: 'player' | 'wing'
  // Roster MS key this pod ejected from (for the wing write-back + logs).
  rosterKey: string
  // Pilot NPC EntityKey. '' for the player pod (the pilot is the player
  // entity, resolved by the caller, not by key).
  pilotKey: string
  nameZh: string
  pos: { x: number; y: number }
  vel: { x: number; y: number }
  // Re-armed whenever no hostile sits inside podCaptureRadiusPx. A capture
  // roll fires only on the transition out-of-range → in-range, so a hostile
  // loitering next to the pod doesn't re-roll every tick, and driving it off
  // (then it returns) gives the pilot a fresh roll.
  captureArmed: boolean
}

// Player pilot fate. `injured` → caller applies the physiology injury.
// `runEnded` (capture branch only) → caller sets player Health.dead.
export type PlayerPodFate =
  | { outcome: 'recovered'; injured: boolean }
  | { outcome: 'captured'; injured: boolean; runEnded: boolean }

// Wing pilot fate. `lost` → caller kills the pilot NPC + clears the seat.
// `recovered` → pilot survives; `injured` → caller applies the injury.
export interface WingPodFate {
  rosterKey: string
  pilotKey: string
  nameZh: string
  outcome: 'recovered' | 'lost'
  injured: boolean
}

// Module-level transient state, mirroring systems/msWings.ts's `wings` and
// systems/combat.ts's `projectiles`: combat-only, reset at start/end.
let playerPod: Pod | null = null
const wingPods: Pod[] = []

function driftVelFrom(vel: { x: number; y: number }): { x: number; y: number } {
  const { podDriftSpeedFrac, podMaxDriftSpeed } = sortieConfig.ejection
  let vx = vel.x * podDriftSpeedFrac
  let vy = vel.y * podDriftSpeedFrac
  const speed = Math.hypot(vx, vy)
  if (speed > podMaxDriftSpeed && speed > 0) {
    const k = podMaxDriftSpeed / speed
    vx *= k
    vy *= k
  }
  return { x: vx, y: vy }
}

// ── Spawns ────────────────────────────────────────────────────────────────

export function spawnPlayerPod(opts: {
  rosterKey: string
  nameZh: string
  pos: { x: number; y: number }
  vel: { x: number; y: number }
}): Pod {
  playerPod = {
    kind: 'player',
    rosterKey: opts.rosterKey,
    pilotKey: '',
    nameZh: opts.nameZh,
    pos: { x: opts.pos.x, y: opts.pos.y },
    vel: driftVelFrom(opts.vel),
    captureArmed: true,
  }
  return playerPod
}

export function spawnWingPod(opts: {
  rosterKey: string
  pilotKey: string
  nameZh: string
  pos: { x: number; y: number }
  vel: { x: number; y: number }
}): Pod {
  const pod: Pod = {
    kind: 'wing',
    rosterKey: opts.rosterKey,
    pilotKey: opts.pilotKey,
    nameZh: opts.nameZh,
    pos: { x: opts.pos.x, y: opts.pos.y },
    vel: driftVelFrom(opts.vel),
    captureArmed: true,
  }
  wingPods.push(pod)
  return pod
}

// ── Reads ───────────────────────────────────────────────────────────────

export function hasPlayerPod(): boolean {
  return playerPod !== null
}

export function hasAnyPod(): boolean {
  return playerPod !== null || wingPods.length > 0
}

// Snapshot for the tactical HUD / renderer. Player pod first when present.
export function getPods(): Pod[] {
  const out: Pod[] = []
  if (playerPod) out.push(playerPod)
  for (const p of wingPods) out.push(p)
  return out
}

// ── Per-tick drift + hostile-reach ────────────────────────────────────────

export function tickPodDrift(dtSec: number): void {
  const step = (p: Pod): void => {
    p.pos.x += p.vel.x * dtSec
    p.pos.y += p.vel.y * dtSec
  }
  if (playerPod) step(playerPod)
  for (const p of wingPods) step(p)
}

function nearestHostileDist(
  pos: { x: number; y: number }, hostiles: readonly { x: number; y: number }[],
): number {
  let best = Infinity
  for (const h of hostiles) {
    const d = Math.hypot(h.x - pos.x, h.y - pos.y)
    if (d < best) best = d
  }
  return best
}

// One distance scan per pod against every hostile. Fires a seeded capture
// roll on the out→in-range transition. Captured pods are REMOVED from state
// and returned so the caller can enact the loss. `playerCaptured` is the
// player pod when it was captured this tick (null otherwise).
export function checkHostileReachCaptures(
  hostiles: readonly { x: number; y: number }[],
): { wingCaptured: Pod[]; playerCaptured: Pod | null } {
  const { podCaptureRadiusPx, podCaptureProbability } = sortieConfig.ejection
  const rng = getSimRng()

  const rollCapture = (p: Pod): boolean => {
    const d = nearestHostileDist(p.pos, hostiles)
    if (d > podCaptureRadiusPx) {
      p.captureArmed = true
      return false
    }
    if (!p.captureArmed) return false
    // In range, armed → roll once, then disarm until the hostile leaves.
    p.captureArmed = false
    return rng.next() < podCaptureProbability
  }

  const wingCaptured: Pod[] = []
  for (let i = wingPods.length - 1; i >= 0; i--) {
    if (rollCapture(wingPods[i])) wingCaptured.push(...wingPods.splice(i, 1))
  }

  let playerCaptured: Pod | null = null
  if (playerPod && rollCapture(playerPod)) {
    playerCaptured = playerPod
    playerPod = null
  }
  return { wingCaptured, playerCaptured }
}

// ── Fate decisions ────────────────────────────────────────────────────────

// The player pod is captured (defeat, or a hostile reached it). Permadeath-
// off: the pilot is captured then rescued later (injured, run continues).
// Permadeath-on: a seeded survival roll may end the run.
export function decidePlayerCaptureFate(): PlayerPodFate {
  if (!isPermadeathEnabled()) {
    return { outcome: 'captured', injured: true, runEnded: false }
  }
  const runEnded = getSimRng().next() < sortieConfig.ejection.podSurvivalRollPermadeath
  // Survived the loss → injured (rescued later). Run ended → dead, no injury.
  return { outcome: 'captured', injured: !runEnded, runEnded }
}

// The player pod is recovered by the friendly fleet (victory / withdraw with
// the flagship alive). Permadeath-off applies the injury arc; permadeath-on
// the pilot is simply back (no survival roll on a clean recovery).
export function decidePlayerRecoveryFate(): PlayerPodFate {
  return { outcome: 'recovered', injured: !isPermadeathEnabled() }
}

// Consume + clear the player pod at engagement end, deciding its fate from
// the combat outcome. Returns null when there was no player pod.
export function resolvePlayerPodAtEnd(
  outcome: 'victory' | 'defeat' | 'flee',
): PlayerPodFate | null {
  if (!playerPod) return null
  playerPod = null
  // Victory or a clean withdraw recovers the pilot; a defeat (flagship lost)
  // means the pod goes down with the fleet → capture-grade loss.
  return outcome === 'defeat' ? decidePlayerCaptureFate() : decidePlayerRecoveryFate()
}

// Consume + clear every wing pod, rolling each pilot's fate. Called at
// engagement end. Crew loss is independent of the permadeath toggle.
export function resolveWingPodFates(): WingPodFate[] {
  const { wingPodRecoveryProbability, wingPodInjuryProbability } = sortieConfig.ejection
  const rng = getSimRng()
  const fates: WingPodFate[] = []
  for (const pod of wingPods) {
    const recovered = rng.next() < wingPodRecoveryProbability
    const injured = recovered && rng.next() < wingPodInjuryProbability
    fates.push({
      rosterKey: pod.rosterKey,
      pilotKey: pod.pilotKey,
      nameZh: pod.nameZh,
      outcome: recovered ? 'recovered' : 'lost',
      injured,
    })
  }
  wingPods.length = 0
  return fates
}

// ── Lifecycle ───────────────────────────────────────────────────────────

export function resetEjection(): void {
  playerPod = null
  wingPods.length = 0
}
