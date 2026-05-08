// Phase 5.5.4 recruitment traits.
//
// Recruiter sits on the recruiter's Workstation entity (the desk).
// criteria + counters mutate at runtime, so they must round-trip through
// save / load. Workstations are EntityKey'd by setupWorld via `ws-<spec>`,
// so the trait simply patches in place.
//
// Applicant sits on a procgen NPC entity spawned by recruitmentSystem at
// runtime. Applicants use `npc-imm-app-<N>` keys so the existing
// immigrant-spawn path in save/index.ts re-creates them on load. The
// applicant's recruiterStation ref serializes via EntityKey indirection.

import type { TraitInstance } from 'koota'
import { registerTraitSerializer } from '../../save/traitRegistry'
import { Recruiter, Applicant } from '../../ecs/traits'

interface RecruiterSnap {
  criteria: TraitInstance<typeof Recruiter>['criteria']
  cumulativeNoHireDays: number
  lastRollDay: number
}

registerTraitSerializer<RecruiterSnap>({
  id: 'recruiter',
  trait: Recruiter,
  read: (e) => {
    const r = e.get(Recruiter)!
    return {
      criteria: { ...r.criteria },
      cumulativeNoHireDays: r.cumulativeNoHireDays,
      lastRollDay: r.lastRollDay,
    }
  },
  write: (e, v) => {
    if (e.has(Recruiter)) e.set(Recruiter, v)
    else e.add(Recruiter(v))
  },
  reset: (e) => {
    if (e.has(Recruiter)) e.set(Recruiter, {
      criteria: { skill: null, minLevel: 0, autoAccept: false },
      cumulativeNoHireDays: 0,
      lastRollDay: 0,
    })
  },
})

interface ApplicantSnap {
  recruiterStation: string | null
  expiresMs: number
  qualityScore: number
  summary: string
  topSkillId: string
  topSkillLevel: number
}

registerTraitSerializer<ApplicantSnap>({
  id: 'applicant',
  trait: Applicant,
  read: (e, ctx) => {
    const a = e.get(Applicant)!
    return {
      recruiterStation: ctx.keyOf(a.recruiterStation),
      expiresMs: a.expiresMs,
      qualityScore: a.qualityScore,
      summary: a.summary,
      topSkillId: a.topSkillId,
      topSkillLevel: a.topSkillLevel,
    }
  },
  write: (e, v, ctx) => {
    const station = ctx.resolveRef(v.recruiterStation)
    const payload = {
      recruiterStation: station,
      expiresMs: v.expiresMs,
      qualityScore: v.qualityScore,
      summary: v.summary,
      topSkillId: v.topSkillId,
      topSkillLevel: v.topSkillLevel,
    }
    if (e.has(Applicant)) e.set(Applicant, payload)
    else e.add(Applicant(payload))
  },
})
