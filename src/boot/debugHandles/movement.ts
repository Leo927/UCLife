// Repath-budget debug handles. Lets the smoke suite verify the per-frame NPC
// pathfinding cap (issue #152): enable stats, force a burst of simultaneous
// NPC repaths, step one tick, then assert npcRepathsRun ≤ budgetK and that
// the player was never deferred.

import { registerDebugHandle } from '../../debug/uclifeHandle'
import { world } from '../../ecs/world'
import { IsPlayer, Position, MoveTarget, Action, Path } from '../../ecs/traits'
import { movementStats } from '../../systems/movement'
import { worldConfig } from '../../config'

const TILE = worldConfig.tilePx

registerDebugHandle('enableRepathStats', (enabled: boolean): void => {
  movementStats.enabled = enabled
})

// Returns the per-frame counts from the most-recent movementSystem() call, plus
// the configured budget K so the test can derive expected deferral counts without
// hard-coding the config value.
registerDebugHandle('repathBudgetStats', () => ({
  playerRepaths: movementStats.lastPlayerRepaths,
  npcRepathsRun: movementStats.lastNpcRepathsRun,
  npcRepathsDeferred: movementStats.lastNpcRepathsDeferred,
  budgetK: worldConfig.pathfinding.npcRepathBudgetPerFrame,
}))

// Give up to `n` NPCs (non-player, idle or walking) a new MoveTarget and
// clear their Path so they all require a fresh pathfind next tick. Only
// targets idle/walking entities because movementSystem skips other action
// kinds — so the returned count accurately reflects the burst the budget
// gate will see. Returns count actually targeted.
registerDebugHandle('forceNpcRepathBurst', (n: number, toTile: { x: number; y: number }): number => {
  const destPx = { x: toTile.x * TILE, y: toTile.y * TILE }
  let count = 0
  for (const e of world.query(Position, Action)) {
    if (e.has(IsPlayer)) continue
    const act = e.get(Action)!
    if (act.kind !== 'idle' && act.kind !== 'walking') continue
    if (count >= n) break
    if (e.has(MoveTarget)) e.set(MoveTarget, destPx)
    else e.add(MoveTarget(destPx))
    if (e.has(Path)) e.remove(Path)
    count++
  }
  return count
})

// Issue a new MoveTarget to the player and clear its current Path, ensuring it
// needs a repath on the next movementSystem() call.
registerDebugHandle('drivePlayerToTile', (tile: { x: number; y: number }): boolean => {
  const player = world.queryFirst(IsPlayer, Position)
  if (!player) return false
  const target = { x: tile.x * TILE, y: tile.y * TILE }
  if (player.has(MoveTarget)) player.set(MoveTarget, target)
  else player.add(MoveTarget(target))
  if (player.has(Path)) player.remove(Path)
  return true
})
