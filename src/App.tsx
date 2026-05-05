import { Game } from './render/Game'
import { SpaceView } from './ui/SpaceView'
import { useScene } from './sim/scene'
import { Hud } from './ui/Hud'
import { ActionStatus } from './ui/ActionStatus'
import { DeathModal } from './ui/DeathModal'
import { StatusPanel } from './ui/StatusPanel'
import { StatusBarFooter } from './ui/StatusBarFooter'
import { ShopModal } from './ui/ShopModal'
import { ClinicModal } from './ui/ClinicModal'
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
import { EngagementModal } from './ui/EngagementModal'
import { TransitionOverlay } from './ui/TransitionOverlay'
import { ShipDealer } from './ui/conversations/ShipDealer'
import { NPCDialog } from './ui/NPCDialog'
import { PortraitModal } from './ui/PortraitModal'
import { PortraitTester } from './render/portrait/__debug__/PortraitTester'
import { SpriteTester } from './render/sprite/__debug__/SpriteTester'

export function App() {
  const activeId = useScene((s) => s.activeId)
  const inSpace = activeId === 'spaceCampaign'
  return (
    <div className="app">
      <Hud />
      <ConditionStrip />
      <Game />
      {inSpace && <SpaceView />}
      <ActionStatus />
      <StatusBarFooter />
      <StatusPanel />
      <ShopModal />
      <ClinicModal />
      <EventLogPanel />
      <DebugPanel />
      <SystemMenu />
      <AmbitionPanel />
      <MapPanel />
      <TransitMap />
      <FlightModal />
      <TacticalView />
      <EngagementModal />
      <ShipDealer />
      <NPCDialog />
      <PortraitModal />
      <DeathModal />
      <Toasts />
      <PortraitTester />
      <SpriteTester />
      <TransitionOverlay />
    </div>
  )
}
