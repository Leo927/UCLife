// Active scene id. Phase 'pre' so it runs before entity overlay —
// the koota `world` proxy resolves to whichever scene is active, so
// byKey lookup needs the right world set first.
//
// Restore picks the right migration path:
//   - spaceCampaign  : flip active scene only (humanoid stays parked
//                      at initialSceneId; on-helm save is ship-as-entity)
//   - other non-init : migratePlayerToScene (snapshots portable traits
//                      + respawns; arrival pos placeholder, overlaid
//                      from EntitySnap.position later)
//   - initialSceneId : direct setActive

import { registerSaveHandler } from '../../save/registry'
import { useScene, migratePlayerToScene } from '../../sim/scene'
import { initialSceneId, sceneIds } from '../../data/scenes'
import type { SceneId } from '../../ecs/world'
import { getActiveSceneId } from '../../ecs/world'

const SPACE_SCENE_ID: SceneId = 'spaceCampaign'

interface SceneBlock {
  activeId: SceneId
}

registerSaveHandler<SceneBlock>({
  id: 'scene',
  phase: 'pre',
  snapshot: () => ({ activeId: getActiveSceneId() }),
  restore: (block) => {
    const target: SceneId = sceneIds.includes(block.activeId)
      ? block.activeId
      : initialSceneId
    if (target === SPACE_SCENE_ID) {
      useScene.getState().setActive(SPACE_SCENE_ID)
    } else if (target !== initialSceneId) {
      migratePlayerToScene(target, { x: 0, y: 0 })
    } else {
      useScene.getState().setActive(target)
    }
  },
  reset: () => {
    useScene.getState().setActive(initialSceneId)
  },
})
