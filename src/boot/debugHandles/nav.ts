// Task 6 — thin debug-drive entry point for starmap navigation, used by
// system-level smokes that need to commit a course without a real click
// (journey specs still click through SpaceView; see
// .claude/skills/deterministic-tests/SKILL.md). Routes straight to the
// same navigateTo()/dockAt() the UI calls, so takeoff fuel + course
// semantics are identical to a real player action.

import { registerDebugHandle } from '../../debug/uclifeHandle'
import { navigateTo, dockAt, poiLivePos, type NavTarget } from '../../sim/navigation'

export type DebugNavTarget = NavTarget | { kind: 'dock'; poiId: string }

registerDebugHandle('debugNavigate', (
  target: DebugNavTarget,
): { ok: boolean; message?: string } => {
  if (target.kind === 'dock') return dockAt(target.poiId)
  return navigateTo(target)
})

// Live POI position for smokes asserting a docked ship actually parked at
// the POI (not a stale point in empty space) — same lookup navigateTo()/
// dockAt() and spaceSim's retarget use, so the assertion shares the one
// source of truth with the code under test.
registerDebugHandle('poiLivePos', poiLivePos)
