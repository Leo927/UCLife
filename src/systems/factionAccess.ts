// Affiliated iff entity carries a matching FactionRole, OR holds a Job
// whose spec.family starts with `${faction}_`. Job-based affiliation
// lapses naturally on quit, so no FactionRole mutation on hire.

import type { Entity } from 'koota'
import { FactionRole, Job, Workstation } from '../ecs/traits'
import { getJobSpec } from '../data/jobs'
import type { FactionId } from '../data/factions'

export function isAffiliated(entity: Entity, faction: FactionId): boolean {
  const fr = entity.get(FactionRole)
  if (fr && fr.faction === faction) return true

  const job = entity.get(Job)
  if (!job || !job.workstation) return false
  const ws = job.workstation.get(Workstation)
  if (!ws) return false
  const spec = getJobSpec(ws.specId)
  if (!spec || !spec.family) return false
  return spec.family.startsWith(`${faction}_`)
}
