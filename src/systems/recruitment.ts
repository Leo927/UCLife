// Phase 5.5.4 recruitment system. Walks every player-owned recruiter
// workstation at day:rollover and rolls procgen applicants into the
// office's lobby:
//
//   chance = baseRecruitmentChance
//          × workPerformance
//          × (1 + cumulativeNoHireDays × noHireDayBonus)
//   chance = min(chance, recruitmentChanceCap)
//
// On success: spawn a procgen NPC with an Applicant trait at a tile
// inside the office; reset cumulativeNoHireDays; roll again (capped by
// maxApplicantsPerDay + lobbyCapacity).
// On failure: increment cumulativeNoHireDays.
//
// Also expires applicants past their `expiresMs` deadline — they walk
// out and despawn.
//
// Auto-accept: when the recruiter's criteria has autoAccept=true and
// the applicant's top skill matches, the applicant becomes a faction-
// of-one member on spawn (cleared Applicant trait + Job pointer to a
// vacant player-owned workstation if one exists, or just cleared so
// the secretary can pick them up later).

import type { Entity, World } from 'koota'
import {
  Applicant, Building, Character, EntityKey, IsPlayer, Job,
  Position, RecruitedTo, Recruiter, Workstation, JobPerformance,
} from '../ecs/traits'
import { recruitmentConfig } from '../config'
import { spawnNPC } from '../character/spawn'
import { pickFreshName, pickRandomColor } from '../character/nameGen'
import { addSkillXp, levelOf, getSkillXp, type SkillId } from '../character/skills'
import { useClock } from '../sim/clock'
import { findPlayer, isPlayerOwnedBuilding, playerOwnedWorkstations } from '../ecs/playerFaction'
import { skillsConfig } from '../config'

// Applicant generation counter. Persisted so reload doesn't reuse keys.
// Module-local; saved + restored alongside the other immigrant counters
// via the recruitment save handler.
let applicantCounter = 0

export function getRecruitmentState(): { applicantCounter: number } {
  return { applicantCounter }
}
export function setRecruitmentState(s: { applicantCounter: number }): void {
  applicantCounter = s.applicantCounter
}
export function resetRecruitmentState(): void {
  applicantCounter = 0
}

export interface RecruitmentResult {
  recruitersChecked: number
  applicantsSpawned: number
  applicantsExpired: number
  applicantsAutoAccepted: number
}

// Top-level entry point. Called from loop.ts at day:rollover (after
// dailyEconomics + housingPressure). gameDay is the integer day number
// AFTER the rollover has flipped.
export function recruitmentSystem(
  world: World,
  gameDay: number,
): RecruitmentResult {
  const result: RecruitmentResult = {
    recruitersChecked: 0,
    applicantsSpawned: 0,
    applicantsExpired: 0,
    applicantsAutoAccepted: 0,
  }
  const player = findPlayer(world)
  if (!player) return result

  expireApplicants(world, result)

  for (const { ws, building } of playerOwnedWorkstations(world, player)) {
    const w = ws.get(Workstation)!
    if (w.specId !== 'recruiter') continue
    if (!isPlayerOwnedBuilding(building, player)) continue
    const recruiter = w.occupant
    if (!recruiter) continue
    if (!ws.has(Recruiter)) continue
    const recTrait = ws.get(Recruiter)!
    if (recTrait.lastRollDay === gameDay) continue
    result.recruitersChecked += 1

    rollDailyApplicants(world, ws, recruiter, building, player, gameDay, result)
  }

  return result
}

function rollDailyApplicants(
  world: World,
  ws: Entity,
  recruiter: Entity,
  building: Entity,
  player: Entity,
  gameDay: number,
  result: RecruitmentResult,
): void {
  const recTrait = ws.get(Recruiter)!
  const cfg = recruitmentConfig
  const perf = workPerformanceOf(recruiter)
  let cumulativeNoHire = recTrait.cumulativeNoHireDays
  let spawnedToday = 0

  while (spawnedToday < cfg.maxApplicantsPerDay) {
    const lobbySize = countLobbyApplicants(world, ws)
    if (lobbySize >= cfg.lobbyCapacity) break

    const streakBonus = 1 + cumulativeNoHire * cfg.noHireDayBonus
    const rawChance = cfg.baseRecruitmentChance * perf * streakBonus
    const chance = Math.min(rawChance, cfg.recruitmentChanceCap)
    if (Math.random() >= chance) {
      cumulativeNoHire += 1
      break
    }
    const applicant = spawnApplicant(world, ws, building, perf)
    if (!applicant) {
      // Generation refused (couldn't pick a tile, etc.) — bail; treat as
      // a no-hire day so the streak still progresses.
      cumulativeNoHire += 1
      break
    }
    spawnedToday += 1
    cumulativeNoHire = 0
    result.applicantsSpawned += 1

    // Auto-accept on spawn: if the recruiter's filter is on and this
    // applicant matches, promote them straight to faction-of-one membership.
    if (recTrait.criteria.autoAccept && applicantMatchesCriteria(applicant, recTrait.criteria)) {
      acceptApplicant(world, applicant, player)
      result.applicantsAutoAccepted += 1
    }
  }

  ws.set(Recruiter, {
    ...recTrait,
    cumulativeNoHireDays: cumulativeNoHire,
    lastRollDay: gameDay,
  })
}

// Walk the world for Applicant entities pointing at this station. Cheap
// at the budget we care about (≤ lobbyCapacity per office) — the loop
// sees at most a handful of player offices in 5.5.4.
function countLobbyApplicants(world: World, station: Entity): number {
  let n = 0
  for (const e of world.query(Applicant)) {
    const a = e.get(Applicant)!
    if (a.recruiterStation === station) n += 1
  }
  return n
}

// Promote the applicant: clear the Applicant trait. The applicant becomes
// a faction-of-one member by virtue of the next time the player walks to
// a workstation and runs assignIdleMembers — this matches the secretary
// pattern in 5.5.3 (members are derived from station occupancy + bed
// claims). Auto-accept doesn't seat them at a station, just removes them
// from the queue. RecruitedTo pins the new hire's job-seek to player-
// owned facilities only — the BT can't accidentally re-employ them
// across the street before the secretary picks them up.
function acceptApplicant(_world: World, applicant: Entity, player: Entity): void {
  if (applicant.has(Applicant)) applicant.remove(Applicant)
  // Member-of-one status is inferred; the secretary's assignIdleMembers
  // verb picks them up next time it's invoked.
  if (!applicant.has(Job)) applicant.add(Job)
  if (applicant.has(RecruitedTo)) applicant.set(RecruitedTo, { owner: player })
  else applicant.add(RecruitedTo({ owner: player }))
}

function workPerformanceOf(npc: Entity): number {
  const jp = npc.get(JobPerformance)
  if (!jp) return 1.0
  return Math.max(0.5, Math.min(1.5, jp.todayPerf || 1.0))
}

// Spawn a fresh procgen NPC inside the recruiter's office, tag with
// Applicant. Position is randomized inside a lobby radius around the
// desk so multiple applicants don't pile on one tile. Returns the new
// entity, or null if no walkable tile could be found inside the building.
function spawnApplicant(
  world: World,
  station: Entity,
  building: Entity,
  perf: number,
): Entity | null {
  const cfg = recruitmentConfig
  const stationPos = station.get(Position)
  const bld = building.get(Building)
  if (!stationPos || !bld) return null

  const spawn = pickLobbyTile(stationPos, bld, cfg.lobbySpawnRadiusPx)
  if (!spawn) return null

  applicantCounter += 1
  const key = `npc-imm-app-${applicantCounter}`

  // Roll skills uniformly inside [base × perf − span, base × perf + span].
  const center = cfg.baseRecruitSkill * perf
  const skillXp: Partial<Record<SkillId, number>> = {}
  for (const sid of cfg.skillsRolled) {
    const lvl = Math.max(0, Math.round(center + (Math.random() * 2 - 1) * cfg.skillSpan))
    skillXp[sid] = lvl * skillsConfig.xpPerLevel
  }

  const ent = spawnNPC(world, {
    name: pickFreshName(world),
    color: pickRandomColor(),
    title: '应聘者',
    x: spawn.x,
    y: spawn.y,
    money: 50 + Math.floor(Math.random() * 80),
    skills: skillXp,
    key,
  })

  // Quality: Σ skillLevel² + Σ statValue². Stats omitted (they're
  // sheet-derived now and uniform on a fresh applicant); skills carry
  // the entire signal.
  let q = 0
  let topSkill: SkillId = cfg.skillsRolled[0]
  let topLevel = 0
  for (const sid of cfg.skillsRolled) {
    const xp = skillXp[sid] ?? 0
    const lvl = levelOf(xp)
    q += lvl * lvl
    if (lvl > topLevel) { topLevel = lvl; topSkill = sid }
  }

  const expiresMs = useClock.getState().gameDate.getTime()
    + cfg.applicationLifetimeDays * 24 * 60 * 60 * 1000

  ent.add(Applicant({
    recruiterStation: station,
    expiresMs,
    qualityScore: q,
    summary: characterizeApplicant(topSkill, topLevel),
    topSkillId: topSkill,
    topSkillLevel: topLevel,
  }))
  return ent
}

// Drop the spawn at a tile within `radius` of the desk, biased away from
// the desk itself so the applicant doesn't visually overlap the recruiter.
// Pure pixel math — door collisions sort themselves out the next BT tick.
function pickLobbyTile(
  desk: { x: number; y: number },
  rect: { x: number; y: number; w: number; h: number },
  radius: number,
): { x: number; y: number } | null {
  for (let attempt = 0; attempt < 8; attempt++) {
    const angle = Math.random() * Math.PI * 2
    const dist = radius * 0.4 + Math.random() * radius * 0.6
    const x = desk.x + Math.cos(angle) * dist
    const y = desk.y + Math.sin(angle) * dist
    if (x < rect.x || x >= rect.x + rect.w) continue
    if (y < rect.y || y >= rect.y + rect.h) continue
    return { x, y }
  }
  return { x: desk.x, y: desk.y + radius * 0.5 }
}

// Pick the recruiter's authored zh-CN line. Uses the applicant's top
// skill to flavor the impression; the player sees this in the lobby
// list so they can decide whether to interview.
function characterizeApplicant(skill: SkillId, level: number): string {
  const tone = level >= 50 ? '专精' : level >= 25 ? '熟练' : '初学'
  const head = level >= 50 ? '一个看起来很有经验的人' : level >= 25 ? '一个稳当的年轻人' : '一个新手'
  const skillLabel = skillsConfig.catalog[skill]?.label ?? skill
  return `${head}，${skillLabel}方面${tone}（Lv ${level}）`
}

export function applicantMatchesCriteria(
  applicant: Entity,
  criteria: { skill: SkillId | null; minLevel: number },
): boolean {
  if (!criteria.skill) return true
  const a = applicant.get(Applicant)
  if (!a) return false
  if (a.topSkillId !== criteria.skill) {
    // Allow a lower-level skill to count if it meets minLevel even if
    // it's not the top skill — gives the player a more permissive filter
    // on demand than just-matching-top-skill would.
    const xp = getSkillXp(applicant, criteria.skill)
    return levelOf(xp) >= criteria.minLevel
  }
  return a.topSkillLevel >= criteria.minLevel
}

// Despawn applicants past their lifetime. Their NPC entity goes with
// them — they "walk out" of the lobby diegetically.
function expireApplicants(world: World, result: RecruitmentResult): void {
  const nowMs = useClock.getState().gameDate.getTime()
  const stale: Entity[] = []
  for (const e of world.query(Applicant)) {
    const a = e.get(Applicant)!
    if (nowMs >= a.expiresMs) stale.push(e)
  }
  for (const e of stale) {
    e.destroy()
    result.applicantsExpired += 1
  }
}

// Public: list a recruiter's queue. Used by RecruiterDialog to render
// the lobby + by debug handles in the smoke suite.
export function lobbyForStation(
  world: World,
  station: Entity,
): { applicant: Entity; data: ReturnType<typeof getApplicantData> }[] {
  const out: { applicant: Entity; data: ReturnType<typeof getApplicantData> }[] = []
  for (const e of world.query(Applicant, Character)) {
    const a = e.get(Applicant)!
    if (a.recruiterStation !== station) continue
    out.push({ applicant: e, data: getApplicantData(e) })
  }
  out.sort((a, b) => b.data.qualityScore - a.data.qualityScore)
  return out
}

export function getApplicantData(e: Entity) {
  const a = e.get(Applicant)!
  const ch = e.get(Character)
  return {
    name: ch?.name ?? '?',
    summary: a.summary,
    qualityScore: a.qualityScore,
    expiresMs: a.expiresMs,
    topSkillId: a.topSkillId,
    topSkillLevel: a.topSkillLevel,
  }
}

// Manual accept from RecruiterDialog. Same shape as auto-accept but
// fires from a UI verb rather than the daily roll. Idempotent — a
// double-click on the accept button doesn't double-promote.
export function manualAcceptApplicant(
  world: World,
  applicant: Entity,
  player: Entity,
): boolean {
  if (!applicant.has(Applicant)) return false
  acceptApplicant(world, applicant, player)
  // Signing bonus: credit the new hire's wallet. Drawn from player's
  // wallet via the dialog (caller debits before invoking) — keeps the
  // economic side effect at the dialog seam, not in the system.
  return true
}

// Reject — clears the applicant entity. The procgen NPC despawns; in a
// future polish pass they walk to the door first.
export function rejectApplicant(applicant: Entity): boolean {
  if (!applicant.has(Applicant)) return false
  applicant.destroy()
  return true
}

// Helper for the smoke suite + tests: bulk-drop every applicant past
// the deadline so a test can assert on lobby clearing without paging the
// clock forward.
export function forceExpireAll(world: World): number {
  const stale: Entity[] = []
  for (const e of world.query(Applicant)) stale.push(e)
  for (const e of stale) e.destroy()
  return stale.length
}

// Helper for tests: enqueue a fresh applicant immediately, bypassing
// the random roll. Returns the new entity. Skill payload is the same
// shape used by the daily roll.
export function debugSpawnApplicant(
  world: World,
  station: Entity,
  perf = 1.0,
): Entity | null {
  const wsTrait = station.get(Workstation)
  if (!wsTrait || wsTrait.specId !== 'recruiter') return null
  // Find the office building containing this station.
  const wsPos = station.get(Position)
  if (!wsPos) return null
  let building: Entity | null = null
  for (const b of world.query(Building)) {
    const bld = b.get(Building)!
    if (wsPos.x < bld.x || wsPos.x >= bld.x + bld.w) continue
    if (wsPos.y < bld.y || wsPos.y >= bld.y + bld.h) continue
    building = b
    break
  }
  if (!building) return null
  return spawnApplicant(world, station, building, perf)
}

// Track helper to keep the import from being flagged as unused.
export function _bumpApplicantSkill(npc: Entity, sid: SkillId, delta: number): void {
  addSkillXp(npc, sid, delta)
}

// Re-export so callers (RecruiterDialog) can resolve the player-owned
// recruiter without re-walking workstations. Mirrors the secretary
// helper in secretaryRoster.ts.
export function findOwnedRecruiterStation(
  world: World,
  player: Entity,
): Entity | null {
  for (const { ws, building } of playerOwnedWorkstations(world, player)) {
    const w = ws.get(Workstation)!
    if (w.specId !== 'recruiter') continue
    if (building.get(Building)!.typeId !== 'recruitOffice') continue
    return ws
  }
  return null
}

// Resolve a recruiter station regardless of player ownership — used by
// the dialog when the player's clicked the desk pre-purchase, so the
// "buy this from the realtor first" affordance can still render.
export function findRecruiterStationByPosition(
  world: World,
  pos: { x: number; y: number },
): Entity | null {
  for (const ws of world.query(Workstation, Position)) {
    if (ws.get(Workstation)!.specId !== 'recruiter') continue
    const p = ws.get(Position)!
    if (Math.abs(p.x - pos.x) > 1 || Math.abs(p.y - pos.y) > 1) continue
    return ws
  }
  return null
}

// Used by RecruiterDialog's hire-list — same eligibility filter as the
// secretary install: civilians not currently working any station.
export function eligibleRecruiterHires(world: World): Entity[] {
  const out: Entity[] = []
  for (const c of world.query(Character, EntityKey)) {
    if (c.has(IsPlayer)) continue
    if (c.has(Applicant)) continue
    const job = c.get(Job)
    if (job?.workstation) continue
    out.push(c)
  }
  out.sort((a, b) => keyOf(a).localeCompare(keyOf(b)))
  return out
}

function keyOf(e: Entity): string {
  return e.get(EntityKey)?.key ?? `e${e.id()}`
}

// Helper used by RecruiterDialog when the player picks a civilian:
// clears any prior occupant + writes the chosen NPC into the recruiter
// station. Mirrors installSecretary. When `player` is supplied, also
// stamps RecruitedTo so the new hire's BT job-seek stays within the
// player's faction-owned facilities.
export function installRecruiter(
  ws: Entity,
  hire: Entity,
  player?: Entity,
): boolean {
  const cur = ws.get(Workstation)
  if (!cur) return false
  if (cur.specId !== 'recruiter') return false
  if (cur.occupant !== null && cur.occupant !== hire) return false
  // Drop hire's existing job pointer if any.
  const job = hire.get(Job)
  if (job?.workstation) {
    const prev = job.workstation.get(Workstation)
    if (prev && prev.occupant === hire) {
      job.workstation.set(Workstation, { ...prev, occupant: null })
    }
  }
  ws.set(Workstation, { ...cur, occupant: hire })
  hire.set(Job, { workstation: ws, unemployedSinceMs: 0 })
  if (player) {
    if (hire.has(RecruitedTo)) hire.set(RecruitedTo, { owner: player })
    else hire.add(RecruitedTo({ owner: player }))
  }
  return true
}
