import { Game } from './render/Game'
import { SpaceView } from './ui/SpaceView'
import { useScene } from './sim/scene'
import { Hud } from './ui/Hud'
import { ActionStatus } from './ui/ActionStatus'
import { DeathModal } from './ui/DeathModal'
import { StatusPanel } from './ui/StatusPanel'
import { InventoryPanel } from './ui/InventoryPanel'
import { StatusBarFooter } from './ui/StatusBarFooter'
import { ConditionStrip } from './ui/ConditionStrip'
import { EventLogPanel } from './ui/EventLogPanel'
import { Toasts } from './ui/Toasts'
import { DebugPanel } from './ui/DebugPanel'
import { SystemMenu } from './ui/SystemMenu'
import { AmbitionPanel } from './ui/AmbitionPanel'
import { MapPanel } from './ui/MapPanel'
import { TransitMap } from './ui/TransitMap'
import { FlightModal } from './ui/FlightModal'
import { TacticalView } from './ui/TacticalView'
import { useCombatStore } from './systems/combat'
import { EngagementModal } from './ui/EngagementModal'
import { TransitionOverlay } from './ui/TransitionOverlay'
import { NPCDialog } from './ui/NPCDialog'
import { ManageFacilityDialog } from './ui/ManageFacilityDialog'
import { PortraitModal } from './ui/PortraitModal'
import { PortraitTester } from './render/portrait/__debug__/PortraitTester'
import { SpriteTester } from './render/sprite/__debug__/SpriteTester'

export function App() {
  const activeId = useScene((s) => s.activeId)
  const inSpace = activeId === 'spaceCampaign'
  // Tactical combat opens its own Pixi Application. Pixi v8's WebGL batcher
  // null-derefs when a second Pixi Application boots alongside a live one
  // (filtered as `Cannot read properties of null (reading 'clear')` in
  // check-space-combat.mjs). Unmounting SpaceView during combat gives the
  // tactical canvas a clean WebGL context.
  const combatOpen = useCombatStore((s) => s.open)
  return (
    <div className="app">
      <Hud />
      <ConditionStrip />
      <Game />
      {inSpace && !combatOpen && <SpaceView />}
      <ActionStatus />
      <StatusBarFooter />
      <StatusPanel />
      <InventoryPanel />
      <EventLogPanel />
      <DebugPanel />
      <SystemMenu />
      <AmbitionPanel />
      <MapPanel />
      <TransitMap />
      <FlightModal />
      <TacticalView />
      <EngagementModal />
      <NPCDialog />
      <ManageFacilityDialog />
      <PortraitModal />
      <DeathModal />
      <Toasts />
      <PortraitTester />
      <SpriteTester />
      <TransitionOverlay />
    </div>
  )
}
