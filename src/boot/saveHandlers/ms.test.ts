// W3 (ms-identity) Task 5 — MS save-handler round-trip coverage for the
// wing-AI roleTag field (and a guard that pre-Task-5 blobs default cleanly).
// Imports the ms handler for its registration side effect, then drives the
// public snapshotAll / restoreAll registry API.

import { describe, it, expect, beforeEach } from 'vitest'
import './ms'
import { snapshotAll, restoreAll } from '../../save/registry'
import { getWorld } from '../../ecs/world'
import { Ms, EntityKey } from '../../ecs/traits'
import { spawnMsEntity } from '../../ecs/spawn'

const SHIP_SCENE_ID = 'playerShipInterior'

function shipWorld() { return getWorld(SHIP_SCENE_ID) }

function roleTagOf(key: string): string | undefined {
  for (const e of shipWorld().query(Ms, EntityKey)) {
    if (e.get(EntityKey)!.key === key) return e.get(Ms)!.roleTag
  }
  return undefined
}

describe('ms save handler — roleTag round-trip', () => {
  beforeEach(() => {
    shipWorld().reset()
  })

  it('snapshot → restore preserves each MS roleTag', () => {
    spawnMsEntity({ key: 'ms-x', templateId: 'gm_pre', storedOnShipKey: 'ship', roleTag: 'antiShip' })
    spawnMsEntity({ key: 'ms-y', templateId: 'gm_pre', storedOnShipKey: 'ship', roleTag: 'fireSupport' })

    const bundle = snapshotAll()
    expect(bundle.ms, 'ms handler must produce a snapshot').toBeTruthy()

    // Restore into a fresh world.
    shipWorld().reset()
    restoreAll(bundle, 'post')

    expect(roleTagOf('ms-x'), 'antiShip must survive the round-trip').toBe('antiShip')
    expect(roleTagOf('ms-y'), 'fireSupport must survive the round-trip').toBe('fireSupport')
  })

  it('a pre-Task-5 blob (no roleTag) restores to the skirmisher default', () => {
    spawnMsEntity({ key: 'ms-z', templateId: 'gm_pre', storedOnShipKey: 'ship', roleTag: 'antiMs' })
    const bundle = snapshotAll() as { ms: { roster: Array<Record<string, unknown>> } }
    // Simulate an older save that never wrote roleTag.
    for (const row of bundle.ms.roster) delete row.roleTag

    shipWorld().reset()
    restoreAll(bundle, 'post')

    expect(roleTagOf('ms-z'), 'missing roleTag defaults to skirmisher').toBe('skirmisher')
  })
})
