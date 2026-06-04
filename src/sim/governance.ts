// Governance council registry — Phase 6.4.C.
// Tracks active faction policies and per-NPC dissent state.
// Persisted via src/boot/saveHandlers/governance.ts.

import type { PolicyKind } from '../config/governance'
export type { PolicyKind }

export interface PolicyRecord {
  kind: PolicyKind
  // Value as a string so both number and string options serialize cleanly.
  value: string
  decidedDay: number
}

export interface DissentRecord {
  npcKey: string
  policyKind: PolicyKind
  expiresDay: number
}

// One active policy per kind at most. A re-decision replaces the old record.
const activePolicies = new Map<PolicyKind, PolicyRecord>()
// One dissent record per NPC. A re-decision replaces the old record.
const dissentRecords = new Map<string, DissentRecord>()

export function getActivePolicy(kind: PolicyKind): PolicyRecord | null {
  return activePolicies.get(kind) ?? null
}

export function getAllActivePolicies(): PolicyRecord[] {
  return [...activePolicies.values()]
}

export function setActivePolicy(record: PolicyRecord): void {
  activePolicies.set(record.kind, record)
}

export function clearActivePolicy(kind: PolicyKind): void {
  activePolicies.delete(kind)
}

export function getDissentRecord(npcKey: string): DissentRecord | null {
  return dissentRecords.get(npcKey) ?? null
}

export function getAllDissentRecords(): DissentRecord[] {
  return [...dissentRecords.values()]
}

export function setDissentRecord(record: DissentRecord): void {
  dissentRecords.set(record.npcKey, record)
}

export function clearDissentRecord(npcKey: string): void {
  dissentRecords.delete(npcKey)
}

export function resetGovernance(): void {
  activePolicies.clear()
  dissentRecords.clear()
}

export function restoreGovernance(
  policies: PolicyRecord[],
  dissent: DissentRecord[],
): void {
  activePolicies.clear()
  dissentRecords.clear()
  for (const p of policies) activePolicies.set(p.kind, p)
  for (const d of dissent) dissentRecords.set(d.npcKey, d)
}
