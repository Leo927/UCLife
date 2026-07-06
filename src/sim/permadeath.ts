// W3 (ms-identity) Task 7 — permadeath toggle.
//
// Design/combat.md §Permadeath: the toggle gates the PLAYER character only
// (crew loss is independent and always permanent). OFF by default. There is
// no persisted settings store yet, so this is a minimal runtime flag seeded
// from config; a future options screen can drive setPermadeath().
//
// permadeath-OFF: player MS integrity 0 → eject + recovery (injury arc), or
//   capture → rescued-later beat. The run continues.
// permadeath-ON : on pod recovery-failure / capture, a seeded survival roll
//   (sortieConfig.ejection.podSurvivalRollPermadeath) can END the run —
//   routed through the existing Health.dead → DeathModal game-over path.

import { sortieConfig } from '../config'

let permadeathEnabled = sortieConfig.ejection.permadeathDefault

export function isPermadeathEnabled(): boolean {
  return permadeathEnabled
}

export function setPermadeath(enabled: boolean): void {
  permadeathEnabled = enabled
}

// Reset to the config default. Called on world reset so a fresh run starts
// from the authored default rather than a previous session's toggle.
export function resetPermadeath(): void {
  permadeathEnabled = sortieConfig.ejection.permadeathDefault
}
