import { create } from 'zustand'
import type { Entity } from 'koota'
import type { CombatDebriefEventPayload } from '../sim/events'

export interface Toast {
  id: number
  text: string
  action?: { label: string; onClick: () => void }
}

// Phase 6.0 (loot panel) + Phase 6.2 (captured POW panel + brig
// occupancy). MS-parts inventory shows up at 6.2.5.
export interface CombatTallyCapturedRow {
  id: string
  nameZh: string
  titleZh?: string
  contextZh: string
}
// Issue #64 — one salvaged MS-part row in the post-combat tally.
export interface CombatTallySalvageRow {
  partId: string
  kind: 'weapon' | 'frameMod'
  nameZh: string
  qty: number
}
export interface CombatTallyPayload {
  creditsDelta: number
  creditsAfter: number
  suppliesDelta: number
  suppliesAfter: number
  suppliesMax: number
  fuelDelta: number
  fuelAfter: number
  fuelMax: number
  capturedPows: CombatTallyCapturedRow[]
  brigOccupied: number
  brigCapacity: number
  salvagedParts: CombatTallySalvageRow[]
}

interface UIState {
  statusOpen: boolean
  inventoryOpen: boolean
  systemOpen: boolean
  mapOpen: boolean
  ambitionsOpen: boolean
  transitSourceId: string | null
  flightHubId: string | null
  // Service-side dialogs (HR, realtor, AE, clinic, pharmacy, shop,
  // secretary, recruiter) all share dialogNPC and render
  // as inline conversation panels inside NPCDialog — see the
  // worker-not-workstation rule in Design/social/diegetic-management.md.
  dialogNPC: Entity | null
  // Per-facility manage cell — set by interactionSystem when the player
  // walks onto a 'manage' Interactable inside a building they own.
  // ManageFacilityDialog reads it to render local-bootstrap verbs.
  dialogManageBuilding: Entity | null
  // Phase 6.0 captain's office — open while the readiness summary panel
  // is on screen. The comm-panel + brig dialogs (6.2) are sibling
  // kiosks in the same room and live as separate booleans so the
  // player can switch between them without closing one to open the
  // other.
  captainsOfficeOpen: boolean
  commPanelOpen: boolean
  brigPanelOpen: boolean
  // Phase 6.2.C2 — fleet roster notebook surface. Opened from the
  // captain's office "舰队名册" button. Standalone modal — closing it
  // returns to the captain's-office panel underneath.
  fleetRosterOpen: boolean
  // Issue #65 — pilot roster notebook surface. Sibling of the fleet
  // roster; opened from the captain's office "驾驶员名册" button.
  pilotRosterOpen: boolean
  // Airport-style gate terminal — opened by pressing E on a gateTerminal
  // interactable in the drydock. Carries the gate id and the bound ship's
  // EntityKey so the panel can subscribe to the ship's traits directly.
  gateTerminal: { gateNumber: string; shipKey: string } | null
  // Disembark dock picker. Fires when the player presses E on the
  // disembarkShip kiosk inside the flagship and the docked POI advertises
  // more than one landing scene. Today every POI has a single scene so this
  // stays dormant; the mechanism is in place for any future POI that grows
  // multiple scenes (e.g. a city + an industrial annex). The picker hands
  // the chosen sceneId back to the same disembark transition used when
  // there's only one option.
  dockPicker: { poiId: string; shipKey: string; candidates: string[] } | null
  // Phase 6.2.E1 — war-room plot table on the flagship bridge. Opened
  // by walking onto the 'warRoom' interactable. Composition verb
  // surface: drag-and-drop tokens between the active grid + reserve
  // tray, per-ship aggression doctrine slider.
  warRoomOpen: boolean
  // Phase 6.2.5.A — MS retrofit panel opened from the hangar terminal.
  // null while closed; holds the targeted MS entity key while open.
  msRetrofitKey: string | null
  // Phase 6.0 post-combat tally — null while no engagement has just
  // resolved with a payout. Set when 'ui:open-combat-tally' fires.
  combatTally: CombatTallyPayload | null
  // W2 Task 6 — defeat / flee debrief beat. Set when 'ui:open-combat-debrief'
  // fires from endCombat's non-victory branches (src/systems/combat.ts);
  // null while no non-victory outcome is awaiting acknowledgement.
  combatDebrief: CombatDebriefEventPayload | null
  // W3 (ms-identity) Task 7 — eject-confirm beat. Non-null while the player's
  // MS is destroyed (or life support hit 0) and the ejection awaits its one
  // confirm click. Set when 'ui:open-eject-confirm' fires; cleared by the
  // modal's confirm or by 'ui:close-eject-confirm'.
  ejectConfirm: { titleZh: string; reasonZh: string } | null
  // Issue #71 — recoverables dialogue. Open while the player resolves
  // survivor hulls / ejected pods; fires BEFORE the tally. The panel reads
  // the live list from systems/recoverables via the __uclife__ surface;
  // this boolean just gates the modal's mount.
  recoverablesOpen: boolean
  // Phase 6.3.A — colony claim panel. Non-null while the player is
  // resolving the claim for the POI identified by the string. Cleared
  // by the panel on cancel or successful claim.
  colonyClaimPoiId: string | null
  // Phase 7.0.C — draft-notice panel. Non-null while the player resolves an
  // outstanding conscription notice (accept / refuse / bribe). Set when
  // 'ui:draft-notice' fires; cleared by the panel on resolution.
  draftNotice: { refusalChance: number; bribeCost: number } | null
  enlargedPortrait: Entity | null
  toasts: Toast[]
  toggleStatus: () => void
  setStatus: (open: boolean) => void
  toggleInventory: () => void
  setInventory: (open: boolean) => void
  setSystem: (open: boolean) => void
  toggleSystem: () => void
  setMap: (open: boolean) => void
  toggleMap: () => void
  setAmbitions: (open: boolean) => void
  toggleAmbitions: () => void
  openTransit: (sourceId: string) => void
  closeTransit: () => void
  openFlight: (hubId: string) => void
  closeFlight: () => void
  setDialogNPC: (e: Entity | null) => void
  setDialogManageBuilding: (e: Entity | null) => void
  setCaptainsOffice: (open: boolean) => void
  setCommPanel: (open: boolean) => void
  setBrigPanel: (open: boolean) => void
  setFleetRoster: (open: boolean) => void
  setPilotRoster: (open: boolean) => void
  openGateTerminal: (gate: { gateNumber: string; shipKey: string } | null) => void
  openDockPicker: (payload: { poiId: string; shipKey: string; candidates: string[] }) => void
  closeDockPicker: () => void
  setWarRoom: (open: boolean) => void
  setMsRetrofit: (msKey: string | null) => void
  setCombatTally: (t: CombatTallyPayload | null) => void
  setCombatDebrief: (d: CombatDebriefEventPayload | null) => void
  setEjectConfirm: (p: { titleZh: string; reasonZh: string } | null) => void
  setRecoverables: (open: boolean) => void
  setColonyClaimPoiId: (poiId: string | null) => void
  setDraftNotice: (notice: { refusalChance: number; bribeCost: number } | null) => void
  setEnlargedPortrait: (e: Entity | null) => void
  showToast: (text: string, durationMs?: number, action?: Toast['action']) => void
  dismissToast: (id: number) => void
}

let toastCounter = 0

// Expose the store on window in dev so Playwright tests + console can drive
// modals without going through canvas clicks.
if (typeof window !== 'undefined' && (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) {
  queueMicrotask(() => {
    ;(window as unknown as { uclifeUI: unknown }).uclifeUI = useUI
  })
}

export const useUI = create<UIState>((set) => ({
  statusOpen: false,
  inventoryOpen: false,
  systemOpen: false,
  mapOpen: false,
  ambitionsOpen: false,
  transitSourceId: null,
  flightHubId: null,
  dialogNPC: null,
  dialogManageBuilding: null,
  captainsOfficeOpen: false,
  commPanelOpen: false,
  brigPanelOpen: false,
  fleetRosterOpen: false,
  pilotRosterOpen: false,
  gateTerminal: null,
  dockPicker: null,
  warRoomOpen: false,
  msRetrofitKey: null,
  combatTally: null,
  combatDebrief: null,
  ejectConfirm: null,
  recoverablesOpen: false,
  colonyClaimPoiId: null,
  draftNotice: null,
  enlargedPortrait: null,
  toasts: [],
  toggleStatus: () => set((s) => ({ statusOpen: !s.statusOpen })),
  setStatus: (open) => set({ statusOpen: open }),
  toggleInventory: () => set((s) => ({ inventoryOpen: !s.inventoryOpen })),
  setInventory: (open) => set({ inventoryOpen: open }),
  setSystem: (open) => set({ systemOpen: open }),
  toggleSystem: () => set((s) => ({ systemOpen: !s.systemOpen })),
  setMap: (open) => set({ mapOpen: open }),
  toggleMap: () => set((s) => ({ mapOpen: !s.mapOpen })),
  setAmbitions: (open) => set({ ambitionsOpen: open }),
  toggleAmbitions: () => set((s) => ({ ambitionsOpen: !s.ambitionsOpen })),
  openTransit: (sourceId) => set({ transitSourceId: sourceId }),
  closeTransit: () => set({ transitSourceId: null }),
  openFlight: (hubId) => set({ flightHubId: hubId }),
  closeFlight: () => set({ flightHubId: null }),
  setDialogNPC: (e) => set({ dialogNPC: e }),
  setDialogManageBuilding: (e) => set({ dialogManageBuilding: e }),
  setCaptainsOffice: (open) => set({ captainsOfficeOpen: open }),
  setCommPanel: (open) => set({ commPanelOpen: open }),
  setBrigPanel: (open) => set({ brigPanelOpen: open }),
  setFleetRoster: (open) => set({ fleetRosterOpen: open }),
  setPilotRoster: (open) => set({ pilotRosterOpen: open }),
  openGateTerminal: (gate) => set({ gateTerminal: gate }),
  openDockPicker: (payload) => set({ dockPicker: payload }),
  closeDockPicker: () => set({ dockPicker: null }),
  setWarRoom: (open) => set({ warRoomOpen: open }),
  setMsRetrofit: (msKey) => set({ msRetrofitKey: msKey }),
  setCombatTally: (t) => set({ combatTally: t }),
  setCombatDebrief: (d) => set({ combatDebrief: d }),
  setEjectConfirm: (p) => set({ ejectConfirm: p }),
  setRecoverables: (open) => set({ recoverablesOpen: open }),
  setColonyClaimPoiId: (poiId) => set({ colonyClaimPoiId: poiId }),
  setDraftNotice: (notice) => set({ draftNotice: notice }),
  setEnlargedPortrait: (e) => set({ enlargedPortrait: e }),
  showToast: (text, durationMs = 4000, action) => {
    const id = ++toastCounter
    set((s) => ({ toasts: [...s.toasts, { id, text, action }] }))
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    }, durationMs)
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))
