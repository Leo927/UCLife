import { create } from 'zustand'
import type { Entity } from 'koota'

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
  // secretary, recruiter, ship-dealer) all share dialogNPC and render
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
  // Phase 6.0 post-combat tally — null while no engagement has just
  // resolved with a payout. Set when 'ui:open-combat-tally' fires.
  combatTally: CombatTallyPayload | null
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
  setCombatTally: (t: CombatTallyPayload | null) => void
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
  combatTally: null,
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
  setCombatTally: (t) => set({ combatTally: t }),
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
