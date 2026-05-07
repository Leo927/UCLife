import { useEffect } from 'react'
import { useQueryFirst, useTrait } from 'koota/react'
import { useClock, formatUC, type Speed } from '../sim/clock'
import { DEBUG_AVAILABLE, useDebug } from '../debug/store'
import { useUI } from './uiStore'
import { IsPlayer, Position } from '../ecs/traits'
import { getSceneTitle } from '../ecs/world'
import { useScene } from '../sim/scene'
import { worldConfig } from '../config'

const SPACE_SCENE_ID = 'spaceCampaign'

const TILE = worldConfig.tilePx

const SPEEDS: { value: Speed; label: string }[] = [
  { value: 0, label: '暂停' },
  { value: 1, label: '1×' },
  { value: 2, label: '2×' },
  { value: 4, label: '4×' },
]

export function Hud() {
  const gameDate = useClock((s) => s.gameDate)
  const speed = useClock((s) => s.speed)
  const setSpeed = useClock((s) => s.setSpeed)
  const mode = useClock((s) => s.mode)
  const toggleDebug = useDebug((s) => s.togglePanel)
  const debugActive = useDebug((s) => s.alwaysHyperspeed || s.freezeNeeds || s.infiniteFuelSupply)
  const toggleSystem = useUI((s) => s.toggleSystem)
  const toggleMap = useUI((s) => s.toggleMap)
  const player = useQueryFirst(IsPlayer, Position)
  const playerPos = useTrait(player, Position)
  const activeSceneId = useScene((s) => s.activeId)

  // City-view hotkeys: M toggles map, C toggles status, I toggles inventory.
  // All three are skipped in the space-campaign scene — SpaceView owns M
  // there, and status/inventory aren't part of the helm UX. ESC closes the
  // topmost modal in any scene; PortraitModal/EngagementModal own their own
  // ESC handlers, so we bail when those are showing to avoid closing two
  // layers at once.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const ui = useUI.getState()
      const anyModal = ui.statusOpen || ui.inventoryOpen || ui.shopOpen || ui.systemOpen
        || ui.mapOpen || ui.ambitionsOpen || ui.shipDealerOpen
        || ui.transitSourceId !== null || ui.flightHubId !== null
        || ui.dialogNPC !== null

      if (e.key === 'Escape') {
        if (ui.enlargedPortrait !== null) return
        if (!anyModal) return
        e.preventDefault()
        // Capture-phase + stopImmediatePropagation suppresses SpaceView's ESC
        // (which would leave-helm) when we're really just closing a UI modal.
        e.stopImmediatePropagation()
        if (ui.dialogNPC !== null) ui.setDialogNPC(null)
        else if (ui.shipDealerOpen) ui.setShipDealer(false)
        else if (ui.shopOpen) ui.setShop(false)
        else if (ui.flightHubId !== null) ui.closeFlight()
        else if (ui.transitSourceId !== null) ui.closeTransit()
        else if (ui.ambitionsOpen) ui.setAmbitions(false)
        else if (ui.mapOpen) ui.setMap(false)
        else if (ui.systemOpen) ui.setSystem(false)
        else if (ui.inventoryOpen) ui.setInventory(false)
        else if (ui.statusOpen) ui.setStatus(false)
        return
      }

      if (e.code === 'KeyM' || e.code === 'KeyC' || e.code === 'KeyI') {
        if (activeSceneId === SPACE_SCENE_ID) return
        if (anyModal && !((e.code === 'KeyC' && ui.statusOpen)
          || (e.code === 'KeyI' && ui.inventoryOpen)
          || (e.code === 'KeyM' && ui.mapOpen))) return
        e.preventDefault()
        if (e.code === 'KeyM') ui.toggleMap()
        else if (e.code === 'KeyC') ui.toggleStatus()
        else if (e.code === 'KeyI') ui.toggleInventory()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [activeSceneId])

  return (
    <div className={`hud ${mode === 'committed' ? 'hyperspeed' : ''}`}>
      <div className="hud-title">
        {getSceneTitle(activeSceneId)} · {formatUC(gameDate)}
        {playerPos && (
          <span className="hud-pos">
            ({Math.floor(playerPos.x / TILE)}, {Math.floor(playerPos.y / TILE)})
          </span>
        )}
        {mode === 'committed' && <span className="hud-skip">⚡ 快进</span>}
      </div>
      <div className="hud-controls">
        {DEBUG_AVAILABLE && (
          <button
            className={`hud-dev ${debugActive ? 'active' : ''}`}
            onClick={toggleDebug}
            title="Debug"
          >
            DEV
          </button>
        )}
        <button
          className="hud-map"
          onClick={toggleMap}
          title="地图"
          aria-label="地图"
        >
          地图
        </button>
        <button
          className="hud-system"
          onClick={toggleSystem}
          title="系统菜单"
          aria-label="系统菜单"
        >
          ☰
        </button>
        {SPEEDS.map((s) => (
          <button
            key={s.value}
            onClick={() => setSpeed(s.value)}
            className={speed === s.value ? 'active' : ''}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  )
}
