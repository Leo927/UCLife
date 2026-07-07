// Phase 6.2.D — fleet crew assignment + captain Effect wiring.
// Pure ECS surface owned by systems/. The UI branches (hireCaptain,
// hireCrew, captain's-office auto-man, crew-assignment panel) wrap
// these in localized strings and player-side gating; the smoke drives
// them through registered debug handles without DOM. Save/load is
// handled by the ship trait (assignedCaptainId, crewIds round-trip
// inside Ship) + the npc save handler (EmployedAsCrew round-trip
// inside the NPC's trait bag) — no new save handler needed.
//
// The captain Effect uses the existing Effect engine — `addShipEffect`
// from src/ecs/shipEffects.ts — with source string
// `eff:officer:<captainKey>:engineering`. Removing the captain calls
// `removeShipEffect` keyed off the same id so a fire/reassign drops
// the StatSheet bonus cleanly.

import type { Entity } from 'koota'
import {
  Ship, EntityKey, Character, Job, Workstation, Money, RecruitedTo,
  EmployedAsCrew, IsPlayer, Applicant, FactionRole, Action,
} from '../ecs/traits'

// Skip the signing fee when the NPC is already a faction member of this
// player. Phase 6.2.D-rev: the hire flow is now unified through the
// `talkHire` dialogue branch — once an NPC carries `RecruitedTo({owner:
// player})`, the player's already paid the signing bonus, and dropping
// them into a ship slot is a no-fee position assignment.
function isAlreadyRecruited(npc: Entity, player: Entity): boolean {
  const r = npc.get(RecruitedTo)
  return !!r && r.owner === player
}
import { getWorld, SCENE_IDS } from '../ecs/world'
import { reconcileCrewAboard } from './crewAboard'
import { fleetConfig } from '../config'
import { getShipClass } from '../data/ship-classes'
import { getStat } from '../stats/sheet'
import { ShipStatSheet, type ShipStatId } from '../ecs/traits'
import { addShipEffect, removeShipEffect } from '../ecs/shipEffects'
import { getSkillXp, levelOf, type SkillId } from '../character/skills'

export type CrewRole = 'captain' | 'crew'

// EntityKey of a ship → live Ship entity. The Ship world is global
// (playerShipInterior); scans cost N ≈ fleet size, which stays in the
// dozens at full 6.2 scope.
export function findShipByKey(shipKey: string): Entity | null {
  if (!shipKey) return null
  const w = getWorld('playerShipInterior')
  for (const e of w.query(Ship, EntityKey)) {
    if (e.get(EntityKey)!.key === shipKey) return e
  }
  return null
}

// EntityKey of an NPC → live Character entity across every scene
// world. The NPC may have hopped between scenes between save and load;
// the lookup stays multi-scene so a crew member assigned at VB still
// resolves after the player rides the orbital lift to the drydock.
export function findNpcByKey(npcKey: string): { entity: Entity; sceneId: string } | null {
  if (!npcKey) return null
  for (const sceneId of SCENE_IDS) {
    const w = getWorld(sceneId)
    for (const e of w.query(Character, EntityKey)) {
      if (e.get(EntityKey)!.key === npcKey) return { entity: e, sceneId }
    }
  }
  return null
}

// Crew vacancy = crewRequired - crewIds.length (captain counts
// separately). Pure read off the Ship + ShipStatSheet, no side effects.
export function crewVacancyForShip(ship: Entity): number {
  const s = ship.get(Ship)
  if (!s) return 0
  const required = ship.has(ShipStatSheet)
    ? Math.floor(getStat(ship.get(ShipStatSheet)!.sheet, 'crewRequired' as ShipStatId))
    : 0
  return Math.max(0, required - s.crewIds.length)
}

// True when the ship has a captain vacancy. Currently identical to
// `s.assignedCaptainId === ''`, but lives as a helper so a future
// per-class captain-required flag plugs in here.
export function hasCaptainVacancy(ship: Entity): boolean {
  const s = ship.get(Ship)
  if (!s) return false
  return s.assignedCaptainId === ''
}

// Charge-and-commit pattern: returns false when the player can't pay
// the signing fee. Caller must hold the gate (no vacancy, NPC ineligible,
// etc.) before invoking. Pure ECS — no toast/UI strings — so the UI
// branches and the captain-talk auto-man verb share one charge path.
function chargePlayerSigningFee(player: Entity, fee: number): boolean {
  if (fee <= 0) return true
  const m = player.get(Money)
  if (!m || m.amount < fee) return false
  player.set(Money, { amount: m.amount - fee })
  return true
}

// Assign an NPC as captain of the ship. Returns true on success.
// Refuses when: NPC is the player; NPC already EmployedAsCrew; NPC is
// an Applicant queue entry; ship has a captain; player can't afford
// the fee. Emits the captain Effect on the ship's StatSheet.
export function hireAsCaptain(
  player: Entity,
  npc: Entity,
  ship: Entity,
): { ok: true; signingFee: number } | { ok: false; reason: 'player' | 'already_employed' | 'applicant' | 'occupied' | 'no_funds' | 'no_keys' } {
  if (npc.has(IsPlayer)) return { ok: false, reason: 'player' }
  if (npc.has(EmployedAsCrew)) return { ok: false, reason: 'already_employed' }
  if (npc.has(Applicant)) return { ok: false, reason: 'applicant' }
  const s = ship.get(Ship)
  if (!s) return { ok: false, reason: 'occupied' }
  if (s.assignedCaptainId !== '') return { ok: false, reason: 'occupied' }
  const npcKey = npc.get(EntityKey)?.key ?? ''
  const shipKey = ship.get(EntityKey)?.key ?? ''
  if (!npcKey || !shipKey) return { ok: false, reason: 'no_keys' }
  const fee = isAlreadyRecruited(npc, player) ? 0 : fleetConfig.hireCaptainSigningFee
  if (!chargePlayerSigningFee(player, fee)) return { ok: false, reason: 'no_funds' }
  applyCaptainAssignment(player, npc, ship, npcKey, shipKey)
  return { ok: true, signingFee: fee }
}

// Internal commit step shared by hireAsCaptain + the move/reassign
// verb. Writes the EntityKey reference into Ship; sets EmployedAsCrew
// + RecruitedTo on the NPC; vacates any prior workstation; emits the
// captain Effect on the ship's StatSheet.
function applyCaptainAssignment(
  player: Entity,
  npc: Entity,
  ship: Entity,
  npcKey: string,
  shipKey: string,
): void {
  const promotedKey = promoteToCrewKey(npc, npcKey)
  const s = ship.get(Ship)!
  ship.set(Ship, { ...s, assignedCaptainId: promotedKey })
  vacateNpcJobForCrew(npc)
  if (npc.has(EmployedAsCrew)) npc.set(EmployedAsCrew, { shipKey, role: 'captain' })
  else npc.add(EmployedAsCrew({ shipKey, role: 'captain' }))
  if (npc.has(RecruitedTo)) npc.set(RecruitedTo, { owner: player })
  else npc.add(RecruitedTo({ owner: player }))
  applyCaptainEffect(ship, npc)
  reconcileCrewAboard(ship)
}

// Monotone counter producing stable `npc-crew-<N>` keys. Hired NPCs
// get promoted to this key shape so the immigrant respawn path in
// src/save/index.ts re-materializes them on a save/load round-trip
// (the original `npc-anon-xxx` keys are unstable across reseed). The
// counter persists alongside population state — see
// boot/saveHandlers/fleetCrewCounter.ts.
let crewKeyCounter = 0
export function getCrewKeyCounter(): number { return crewKeyCounter }
export function setCrewKeyCounter(n: number): void { crewKeyCounter = n }
export function resetCrewKeyCounter(): void { crewKeyCounter = 0 }

function promoteToCrewKey(npc: Entity, currentKey: string): string {
  if (currentKey.startsWith('npc-crew-')) return currentKey
  crewKeyCounter += 1
  const next = `npc-crew-${crewKeyCounter}`
  npc.set(EntityKey, { key: next })
  return next
}

// Add an NPC to the ship's crew list. Refuses for the same set of
// reasons as captain, plus vacancy. Does NOT emit a per-crew Effect at
// this slice — only the captain has a stat impact in 6.2.D.
export function hireAsCrew(
  player: Entity,
  npc: Entity,
  ship: Entity,
): { ok: true; signingFee: number } | { ok: false; reason: 'player' | 'already_employed' | 'applicant' | 'no_vacancy' | 'no_funds' | 'no_keys' } {
  if (npc.has(IsPlayer)) return { ok: false, reason: 'player' }
  if (npc.has(EmployedAsCrew)) return { ok: false, reason: 'already_employed' }
  if (npc.has(Applicant)) return { ok: false, reason: 'applicant' }
  if (crewVacancyForShip(ship) <= 0) return { ok: false, reason: 'no_vacancy' }
  const npcKey = npc.get(EntityKey)?.key ?? ''
  const shipKey = ship.get(EntityKey)?.key ?? ''
  if (!npcKey || !shipKey) return { ok: false, reason: 'no_keys' }
  const fee = isAlreadyRecruited(npc, player) ? 0 : fleetConfig.hireCrewSigningFee
  if (!chargePlayerSigningFee(player, fee)) return { ok: false, reason: 'no_funds' }
  applyCrewAssignment(player, npc, ship, npcKey, shipKey)
  return { ok: true, signingFee: fee }
}

function applyCrewAssignment(
  player: Entity,
  npc: Entity,
  ship: Entity,
  npcKey: string,
  shipKey: string,
): void {
  const promotedKey = promoteToCrewKey(npc, npcKey)
  const s = ship.get(Ship)!
  ship.set(Ship, { ...s, crewIds: [...s.crewIds, promotedKey] })
  vacateNpcJobForCrew(npc)
  if (npc.has(EmployedAsCrew)) npc.set(EmployedAsCrew, { shipKey, role: 'crew' })
  else npc.add(EmployedAsCrew({ shipKey, role: 'crew' }))
  if (npc.has(RecruitedTo)) npc.set(RecruitedTo, { owner: player })
  else npc.add(RecruitedTo({ owner: player }))
  reconcileCrewAboard(ship)
}

// Vacate any prior workstation seat. Mirrors talkHireBranch's vacancy
// step so a prior employer's roster doesn't keep a stale ref. No-op
// when the NPC was already idle.
function vacateNpcJobForCrew(npc: Entity): void {
  const job = npc.get(Job)
  const ws = job?.workstation ?? null
  if (ws) {
    const cur = ws.get(Workstation)
    if (cur && cur.occupant === npc) ws.set(Workstation, { ...cur, occupant: null })
  }
  npc.set(Job, { workstation: null, unemployedSinceMs: 0 })
}

// Fire the captain. Removes from Ship + drops the captain Effect, then
// reconciles so the aboard body leaves the ship. Returns true if a captain
// was actually removed. W4.1: the crew body lives aboard, so reconcile
// (which keys off EmployedAsCrew) destroys the off-roster body — the marker
// is intentionally left on until reconcile so it can find it.
export function fireCaptain(ship: Entity): boolean {
  const s = ship.get(Ship)
  if (!s || s.assignedCaptainId === '') return false
  removeCaptainEffect(ship, s.assignedCaptainId)
  ship.set(Ship, { ...s, assignedCaptainId: '' })
  reconcileCrewAboard(ship)
  return true
}

// Fire a specific crew member by entity key. The aboard body is removed by
// the reconcile pass (see fireCaptain).
export function fireCrewMember(ship: Entity, npcKey: string): boolean {
  const s = ship.get(Ship)
  if (!s) return false
  const idx = s.crewIds.indexOf(npcKey)
  if (idx < 0) return false
  const next = s.crewIds.filter((k) => k !== npcKey)
  ship.set(Ship, { ...s, crewIds: next })
  reconcileCrewAboard(ship)
  return true
}

// Move a crew member from one ship to another. Refuses if the source
// has no such crew entry, or if the destination has no vacancy. Free
// — no signing-fee charged on a move (the NPC stays in the player's
// pay). Captain moves are not supported by this verb; use fireCaptain
// + hireAsCaptain instead.
export function moveCrewMember(
  fromShip: Entity,
  toShip: Entity,
  npcKey: string,
): { ok: true } | { ok: false; reason: 'not_in_source' | 'no_vacancy' | 'same_ship' } {
  if (fromShip === toShip) return { ok: false, reason: 'same_ship' }
  const fromS = fromShip.get(Ship)
  const toS = toShip.get(Ship)
  if (!fromS || !toS) return { ok: false, reason: 'not_in_source' }
  if (!fromS.crewIds.includes(npcKey)) return { ok: false, reason: 'not_in_source' }
  if (crewVacancyForShip(toShip) <= 0) return { ok: false, reason: 'no_vacancy' }
  fromShip.set(Ship, { ...fromS, crewIds: fromS.crewIds.filter((k) => k !== npcKey) })
  toShip.set(Ship, { ...toS, crewIds: [...toS.crewIds, npcKey] })
  const toShipKey = toShip.get(EntityKey)?.key ?? ''
  const npcEnt = findNpcByKey(npcKey)?.entity
  if (npcEnt && npcEnt.has(EmployedAsCrew)) {
    npcEnt.set(EmployedAsCrew, { shipKey: toShipKey, role: 'crew' })
  }
  reconcileCrewAboard(fromShip)
  reconcileCrewAboard(toShip)
  return { ok: true }
}

// "Man the rest from idle pool" — captain's-office verb. Walks every
// scene world for procedural NPCs without a Job + without an
// EmployedAsCrew assignment + not Applicant + not Player + not in a
// faction role (faction NPCs are special-character pinned). Hires them
// one at a time until: vacancy filled, player out of money, or the
// per-click cap is hit.
export interface ManFromIdleResult {
  hired: number
  signingFeesPaid: number
  stoppedReason: 'filled' | 'no_funds' | 'no_idle' | 'cap'
}

export function manRestFromIdlePool(
  player: Entity,
  ship: Entity,
): ManFromIdleResult {
  const out: ManFromIdleResult = { hired: 0, signingFeesPaid: 0, stoppedReason: 'filled' }
  let vacancy = crewVacancyForShip(ship)
  if (vacancy <= 0) return out
  const cap = fleetConfig.manFromIdlePoolMaxPerClick
  let toHire = Math.min(vacancy, cap)
  const candidates = findIdleHireableNpcs()
  if (candidates.length === 0) {
    out.stoppedReason = 'no_idle'
    return out
  }
  for (const npc of candidates) {
    if (toHire <= 0) break
    const m = player.get(Money)
    if (!m || m.amount < fleetConfig.hireCrewSigningFee) {
      out.stoppedReason = 'no_funds'
      return out
    }
    const r = hireAsCrew(player, npc, ship)
    if (!r.ok) continue
    out.hired += 1
    out.signingFeesPaid += r.signingFee
    toHire -= 1
    vacancy -= 1
  }
  if (vacancy > 0 && toHire === 0) out.stoppedReason = 'cap'
  else if (vacancy > 0) out.stoppedReason = 'no_idle'
  else out.stoppedReason = 'filled'
  return out
}

// Walks every scene world for NPCs that look like "idle hireable" —
// procedural civilians with no Job, no EmployedAsCrew, no Applicant
// marker, and not the player. Returns a snapshot Array; callers iterate
// without re-querying.
export function findIdleHireableNpcs(): Entity[] {
  const out: Entity[] = []
  for (const sceneId of SCENE_IDS) {
    const w = getWorld(sceneId)
    for (const npc of w.query(Character, EntityKey)) {
      if (!isIdleHireable(npc)) continue
      out.push(npc)
    }
  }
  return out
}

// Phase 6.2.D-rev — faction-member pool walker for ship-slot
// assignment. Hire flow is unified through `talkHire` (邀请加入); once
// an NPC carries `RecruitedTo({owner: player})`, dropping them into a
// captain or crew seat is a free position assignment and pulls from
// this pool. Filters: must be RecruitedTo this player, must not already
// be EmployedAsCrew (one ship slot at a time), must not be Applicant /
// player.
export function findFactionPoolForAssignment(player: Entity): Entity[] {
  const out: Entity[] = []
  for (const sceneId of SCENE_IDS) {
    const w = getWorld(sceneId)
    for (const npc of w.query(Character, EntityKey, RecruitedTo)) {
      if (npc.has(IsPlayer)) continue
      if (npc.has(EmployedAsCrew)) continue
      if (npc.has(Applicant)) continue
      const r = npc.get(RecruitedTo)
      if (!r || r.owner !== player) continue
      out.push(npc)
    }
  }
  return out
}

// Bulk-assign faction members to the ship's open crew slots. Mirrors
// `manRestFromIdlePool`'s shape; the difference is that the pool is
// `findFactionPoolForAssignment` (already-hired faction members) and
// no signing fee is charged — `hireAsCrew` short-circuits the fee for
// any NPC carrying RecruitedTo for this player.
export function manRestFromFactionPool(
  player: Entity,
  ship: Entity,
): ManFromIdleResult {
  const out: ManFromIdleResult = { hired: 0, signingFeesPaid: 0, stoppedReason: 'filled' }
  let vacancy = crewVacancyForShip(ship)
  if (vacancy <= 0) return out
  const cap = fleetConfig.manFromIdlePoolMaxPerClick
  let toHire = Math.min(vacancy, cap)
  const candidates = findFactionPoolForAssignment(player)
  if (candidates.length === 0) {
    out.stoppedReason = 'no_idle'
    return out
  }
  for (const npc of candidates) {
    if (toHire <= 0) break
    const r = hireAsCrew(player, npc, ship)
    if (!r.ok) continue
    out.hired += 1
    out.signingFeesPaid += r.signingFee
    toHire -= 1
    vacancy -= 1
  }
  if (vacancy > 0 && toHire === 0) out.stoppedReason = 'cap'
  else if (vacancy > 0) out.stoppedReason = 'no_idle'
  else out.stoppedReason = 'filled'
  return out
}

function isIdleHireable(npc: Entity): boolean {
  if (npc.has(IsPlayer)) return false
  if (npc.has(EmployedAsCrew)) return false
  if (npc.has(Applicant)) return false
  const job = npc.get(Job)
  if (job?.workstation) return false
  const fr = npc.get(FactionRole)
  if (fr && fr.faction !== 'civilian') return false
  return true
}

// Returns the captain-Effect id used on the ship's ShipEffectsList.
// Same shape Design/fleet.md documents: `eff:officer:<key>:<skill>`.
export function captainEffectId(captainKey: string): string {
  return `eff:officer:${captainKey}:${fleetConfig.captainEffectSkill}`
}

function applyCaptainEffect(ship: Entity, captain: Entity): void {
  const captainKey = captain.get(EntityKey)?.key ?? ''
  if (!captainKey) return
  if (!ship.has(ShipStatSheet)) return
  const skill = fleetConfig.captainEffectSkill as SkillId
  const lv = levelOf(getSkillXp(captain, skill))
  const value = lv * fleetConfig.captainEffectPerLevel
  addShipEffect(ship, {
    id: captainEffectId(captainKey),
    originId: captainKey,
    family: 'gear',
    modifiers: [
      {
        statId: fleetConfig.captainEffectStat as ShipStatId,
        type: 'percentMult',
        value,
      },
    ],
  })
}

function removeCaptainEffect(ship: Entity, captainKey: string): void {
  if (!ship.has(ShipStatSheet)) return
  removeShipEffect(ship, captainEffectId(captainKey))
}

// Sanity helper for the smoke + the crew panel — fetch every crew /
// captain row across the fleet, with display names resolved.
export interface CrewRosterRow {
  shipKey: string
  shipName: string
  captainKey: string
  captainName: string
  crew: Array<{ npcKey: string; name: string }>
  crewRequired: number
  crewMax: number
}

export function snapshotCrewRoster(): CrewRosterRow[] {
  const out: CrewRosterRow[] = []
  const shipWorld = getWorld('playerShipInterior')
  for (const ship of shipWorld.query(Ship, EntityKey)) {
    const s = ship.get(Ship)!
    const cls = getShipClass(s.templateId)
    const crewRequired = ship.has(ShipStatSheet)
      ? Math.floor(getStat(ship.get(ShipStatSheet)!.sheet, 'crewRequired' as ShipStatId))
      : 0
    out.push({
      shipKey: ship.get(EntityKey)!.key,
      shipName: cls.nameZh,
      captainKey: s.assignedCaptainId,
      captainName: s.assignedCaptainId ? nameOfNpc(s.assignedCaptainId) : '',
      crew: s.crewIds.map((k) => ({ npcKey: k, name: nameOfNpc(k) })),
      crewRequired,
      crewMax: cls.crewMax,
    })
  }
  return out
}

function nameOfNpc(npcKey: string): string {
  const hit = findNpcByKey(npcKey)
  if (!hit) return npcKey
  return hit.entity.get(Character)?.name ?? npcKey
}

// Re-apply the captain Effect from the persisted Ship.assignedCaptainId.
// Called by the ship save handler after restore so the StatSheet bonus
// re-projects without the player having to fire+rehire the captain.
export function reapplyCaptainEffectsOnRestore(): void {
  const shipWorld = getWorld('playerShipInterior')
  for (const ship of shipWorld.query(Ship)) {
    const s = ship.get(Ship)!
    if (!s.assignedCaptainId) continue
    const hit = findNpcByKey(s.assignedCaptainId)
    if (!hit) continue
    applyCaptainEffect(ship, hit.entity)
  }
}

// Marker import to keep the otherwise-unused Action symbol referenced —
// future hire flows may toggle the recruited NPC's action state so the
// idle pool query doesn't trip on a stale 'working' action.
void Action
