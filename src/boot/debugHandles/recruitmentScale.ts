// Phase 6.4.B — recruitment-scale debug handles.
// Extends the Phase 5.5.4 recruitment surface with officer Leadership
// gate, faction-lean criteria, and salary-tick introspection for the
// recruitment-scale smoke suite.

import { registerDebugHandle } from '../../debug/uclifeHandle'
import { world, SCENE_IDS, getWorld } from '../../ecs/world'
import {
  Applicant, IsPlayer, RecruitedTo, Recruiter, Workstation,
} from '../../ecs/traits'
import {
  findOwnedRecruiterStation, lobbyForStation, applyOfficerAutoApprove,
  type RecruitmentResult,
} from '../../systems/recruitment'
import { factionSalarySystem } from '../../systems/factionSalary'
import { addSkillXp, levelOf, getSkillXp } from '../../character/skills'
import { recruitmentConfig } from '../../config'
import { gameDayNumber, useClock } from '../../sim/clock'
import type { Entity } from 'koota'

function countRecruitedFor(player: Entity): number {
  let n = 0
  for (const sceneId of SCENE_IDS) {
    const w = getWorld(sceneId)
    for (const e of w.query(RecruitedTo)) {
      if (e.get(RecruitedTo)!.owner === player) n += 1
    }
  }
  return n
}

// Set the leadership-standin (Engineering) XP on the currently seated
// recruitment officer. Used by the smoke to compare high-skill vs
// low-skill officer auto-approve behavior deterministically.
registerDebugHandle('setOfficerLeadershipXp', (xp: number): { ok: boolean; reason?: string; level?: number } => {
  const player = world.queryFirst(IsPlayer)
  if (!player) return { ok: false, reason: 'no player' }
  const ws = findOwnedRecruiterStation(world, player)
  if (!ws) return { ok: false, reason: 'no player-owned recruiter station' }
  const officer = ws.get(Workstation)?.occupant ?? null
  if (!officer) return { ok: false, reason: 'no officer seated at station' }
  const skillId = recruitmentConfig.officerAutoApprove.leadershipSkillStandin
  const currentXp = getSkillXp(officer, skillId)
  if (currentXp > 0) addSkillXp(officer, skillId, -currentXp)
  if (xp > 0) addSkillXp(officer, skillId, xp)
  const level = levelOf(getSkillXp(officer, skillId))
  return { ok: true, level }
})

// Count NPCs in any scene that hold the RecruitedTo trait pointing at
// the player. Used to assert that applicants promoted into the faction
// roster appear here.
registerDebugHandle('countRecruitedMembers', (): number => {
  const player = world.queryFirst(IsPlayer)
  if (!player) return 0
  return countRecruitedFor(player)
})

interface SalaryResult {
  membersPaid: number
  totalDebit: number
  shortfall: number
}

// Run the faction salary system once and return the debit summary.
// Lets the smoke test verify that approved applicants immediately
// contribute to the daily salary bill.
registerDebugHandle('forceFactionSalaryTick', (): SalaryResult => {
  const shipWorld = getWorld('playerShipInterior')
  const gameDay = gameDayNumber(useClock.getState().gameDate)
  const result = factionSalarySystem(shipWorld, gameDay)
  return {
    membersPaid: result.membersPaid,
    totalDebit: result.totalDebit,
    shortfall: result.shortfall,
  }
})

interface AutoApproveResult {
  applied: number
  accepted: number
}

// Apply the officer auto-approve logic to all applicants currently in the
// recruiter lobby. Mirrors the logic from rollDailyApplicants so the smoke
// can test mis-hire behavior on a pre-filled lobby (seeded RNG for
// determinism) without going through the full daily-roll path.
registerDebugHandle('runOfficerAutoApproveForLobby', (): AutoApproveResult => {
  const player = world.queryFirst(IsPlayer)
  if (!player) return { applied: 0, accepted: 0 }
  const ws = findOwnedRecruiterStation(world, player)
  if (!ws) return { applied: 0, accepted: 0 }
  const officer = ws.get(Workstation)?.occupant ?? null
  if (!officer) return { applied: 0, accepted: 0 }
  const recTrait = ws.get(Recruiter)
  if (!recTrait) return { applied: 0, accepted: 0 }

  const lobby = lobbyForStation(world, ws)
  if (lobby.length === 0) return { applied: 0, accepted: 0 }

  const preCount = countRecruitedFor(player)
  const result: RecruitmentResult = {
    recruitersChecked: 0, applicantsSpawned: 0, applicantsExpired: 0, applicantsAutoAccepted: 0,
  }

  for (const { applicant } of lobby) {
    if (!applicant.has(Applicant)) continue
    applyOfficerAutoApprove(world, applicant, officer, recTrait.criteria, player, result)
  }

  const postCount = countRecruitedFor(player)
  return { applied: lobby.length, accepted: postCount - preCount }
})

// Return the faction lean of each applicant currently in the lobby.
// Lets the smoke test verify that faction lean is rolled at spawn time
// and persists on the Applicant trait.
registerDebugHandle('recruiterLobbyFactionLeans', (): Array<{ name: string; factionLean: string | null }> => {
  const player = world.queryFirst(IsPlayer)
  if (!player) return []
  const ws = findOwnedRecruiterStation(world, player)
  if (!ws) return []
  return lobbyForStation(world, ws).map(({ data }) => ({
    name: data.name,
    factionLean: data.factionLean,
  }))
})

// Return snapshot of the player's recruiter station criteria.
// Used by the save round-trip test to assert criteria persist.
registerDebugHandle('recruiterCriteriaSnapshot', (): {
  skill: string | null
  minLevel: number
  factionLean: string | null
  autoAccept: boolean
} | null => {
  const player = world.queryFirst(IsPlayer)
  if (!player) return null
  const ws = findOwnedRecruiterStation(world, player)
  if (!ws) return null
  const recTrait = ws.get(Recruiter)
  if (!recTrait) return null
  const c = recTrait.criteria
  return { skill: c.skill, minLevel: c.minLevel, factionLean: c.factionLean, autoAccept: c.autoAccept }
})

