// Conscription state (Phase 7.0.C) — the player's draft-notice lifecycle plus
// the clinic medical letter they may be holding. A sim-layer module store
// (mirroring sim/warState.ts): global, not a per-scene ECS trait, and the only
// consumer is the conscription system, so it stays out of the player traits.
//
// Lifecycle: once wartime, the draft roll may issue a notice
// (noticeOutstanding=true). The player resolves it (accept / refuse / bribe);
// resolution clears the notice, records the outcome, and sets a cooldown so
// the next roll waits `cooldownDays`. `medicalLetterHeld` is the clinic
// consumable that tilts the refusal roll — set at the clinic, spent on use.

import { create } from 'zustand'

export type DraftResolution = 'none' | 'refused' | 'drafted'

interface ConscriptionStateData {
  // A draft notice is currently awaiting the player's resolution.
  noticeOutstanding: boolean
  // 1-based game day the last notice issued (0 = never).
  lastNoticeDay: number
  // 1-based game day the last draft roll ran (0 = never). Drives the cadence.
  lastRollDay: number
  // No new notice may issue until this game day (0 = no cooldown).
  cooldownUntilDay: number
  // Outcome of the most recent resolution.
  resolution: DraftResolution
  // The player holds a clinic medical letter (refusal-roll modifier).
  medicalLetterHeld: boolean
}

const EMPTY: ConscriptionStateData = {
  noticeOutstanding: false,
  lastNoticeDay: 0,
  lastRollDay: 0,
  cooldownUntilDay: 0,
  resolution: 'none',
  medicalLetterHeld: false,
}

export const useConscription = create<ConscriptionStateData>(() => ({ ...EMPTY }))

export function hasDraftNotice(): boolean {
  return useConscription.getState().noticeOutstanding
}

export function getDraftResolution(): DraftResolution {
  return useConscription.getState().resolution
}

export function hasMedicalLetter(): boolean {
  return useConscription.getState().medicalLetterHeld
}

export function getCooldownUntilDay(): number {
  return useConscription.getState().cooldownUntilDay
}

export function getLastNoticeDay(): number {
  return useConscription.getState().lastNoticeDay
}

export function getLastRollDay(): number {
  return useConscription.getState().lastRollDay
}

export function markRollDay(gameDay: number): void {
  useConscription.setState({ lastRollDay: gameDay })
}

// Issue a draft notice (no-op if one is already outstanding).
export function issueDraftNotice(gameDay: number): boolean {
  if (useConscription.getState().noticeOutstanding) return false
  useConscription.setState({ noticeOutstanding: true, lastNoticeDay: gameDay, resolution: 'none' })
  return true
}

// Resolve the outstanding notice: clear it, record the outcome, and start the
// cooldown. Consumes the medical letter regardless of outcome (it was filed).
export function resolveDraftNotice(
  resolution: DraftResolution,
  cooldownUntilDay: number,
  consumeMedicalLetter: boolean,
): void {
  useConscription.setState((s) => ({
    noticeOutstanding: false,
    resolution,
    cooldownUntilDay,
    medicalLetterHeld: consumeMedicalLetter ? false : s.medicalLetterHeld,
  }))
}

export function grantMedicalLetter(): void {
  useConscription.setState({ medicalLetterHeld: true })
}

// ── Persistence ────────────────────────────────────────────────────────────

export interface ConscriptionSnapshot {
  noticeOutstanding: boolean
  lastNoticeDay: number
  lastRollDay: number
  cooldownUntilDay: number
  resolution: DraftResolution
  medicalLetterHeld: boolean
}

export function snapshotConscription(): ConscriptionSnapshot {
  return { ...useConscription.getState() }
}

export function restoreConscription(blob: ConscriptionSnapshot): void {
  useConscription.setState({
    noticeOutstanding: Boolean(blob.noticeOutstanding),
    lastNoticeDay: blob.lastNoticeDay ?? 0,
    lastRollDay: blob.lastRollDay ?? 0,
    cooldownUntilDay: blob.cooldownUntilDay ?? 0,
    resolution: blob.resolution ?? 'none',
    medicalLetterHeld: Boolean(blob.medicalLetterHeld),
  })
}

export function resetConscription(): void {
  useConscription.setState({ ...EMPTY })
}
