import { create } from 'zustand'
import type { Entity } from 'koota'

export interface Toast {
  id: number
  text: string
  action?: { label: string; onClick: () => void }
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
