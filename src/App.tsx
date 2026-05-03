import { Game } from './render/Game'
import { Hud } from './ui/Hud'
import { ActionStatus } from './ui/ActionStatus'
import { DeathModal } from './ui/DeathModal'
import { StatusPanel } from './ui/StatusPanel'
import { StatusBarFooter } from './ui/StatusBarFooter'
import { ShopModal } from './ui/ShopModal'
import { Toasts } from './ui/Toasts'
import { DebugPanel } from './ui/DebugPanel'
import { SystemMenu } from './ui/SystemMenu'
import { AmbitionPanel } from './ui/AmbitionPanel'
import { MapPanel } from './ui/MapPanel'
import { TransitMap } from './ui/TransitMap'
import { FlightModal } from './ui/FlightModal'
import { StarmapPanel } from './ui/StarmapPanel'
import { EncounterModal } from './ui/EncounterModal'
import { TacticalView } from './ui/TacticalView'
import { TransitionOverlay } from './ui/TransitionOverlay'
import { ShipDealer } from './ui/conversations/ShipDealer'
import { NPCDialog } from './ui/NPCDialog'
import { PortraitModal } from './ui/PortraitModal'
import { PortraitTester } from './render/portrait/__debug__/PortraitTester'
import { SpriteTester } from './render/sprite/__debug__/SpriteTester'

export function App() {
  return (
    <div className="app">
      <Hud />
      <Game />
      <ActionStatus />
      <StatusBarFooter />
      <StatusPanel />
      <ShopModal />
      <DebugPanel />
      <SystemMenu />
      <AmbitionPanel />
      <MapPanel />
      <TransitMap />
      <FlightModal />
      <StarmapPanel />
      <EncounterModal />
      <TacticalView />
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
