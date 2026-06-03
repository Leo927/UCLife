import json5 from 'json5'
import raw from './recruitment.json5?raw'
import type { SkillId } from './skills'
import type { FactionId } from './factions'

export interface RecruitmentConfig {
  baseRecruitmentChance: number
  recruitmentChanceCap: number
  noHireDayBonus: number
  maxApplicantsPerDay: number
  baseRecruitSkill: number
  skillSpan: number
  skillsRolled: SkillId[]
  lobbyCapacity: number
  applicationLifetimeDays: number
  lobbySpawnRadiusPx: number
  factionMemberDailySalary: number
  talkVerbHire: {
    factionRepGate: { faction: FactionId; min: number }
    opinionGate: { min: number }
    signingBonus: number
  }
  // Phase 6.4.B — faction lean pool and officer auto-approve config.
  factionLeanPool: FactionId[]
  officerAutoApprove: {
    leadershipSkillStandin: SkillId
    highSkillThreshold: number
    lowSkillMishireRate: number
  }
}

export const recruitmentConfig = json5.parse(raw) as RecruitmentConfig
