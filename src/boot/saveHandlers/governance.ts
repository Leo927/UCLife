// Phase 6.4.C — governance council save handler.
// Persists active faction policies and per-NPC dissent records.

import { registerSaveHandler } from '../../save/registry'
import {
  getAllActivePolicies, getAllDissentRecords, resetGovernance, restoreGovernance,
  type PolicyRecord, type DissentRecord,
} from '../../sim/governance'

interface GovernanceSnapshot {
  policies: PolicyRecord[]
  dissent: DissentRecord[]
}

registerSaveHandler<GovernanceSnapshot>({
  id: 'governance',
  phase: 'post',
  snapshot: () => {
    const policies = getAllActivePolicies()
    const dissent = getAllDissentRecords()
    if (policies.length === 0 && dissent.length === 0) return undefined
    return { policies, dissent }
  },
  restore: (blob) => {
    restoreGovernance(blob.policies ?? [], blob.dissent ?? [])
  },
  reset: () => {
    resetGovernance()
  },
})
