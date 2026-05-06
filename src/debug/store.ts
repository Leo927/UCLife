import { create } from 'zustand'

// Falls back to false in plain Node (headless harnesses) where
// import.meta.env isn't populated by Vite.
export const DEBUG_AVAILABLE: boolean = !!(import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV

interface DebugState {
  panelOpen: boolean
  alwaysHyperspeed: boolean
  freezeNeeds: boolean
  infiniteFuelSupply: boolean
  // Drives the player entity via NPC behavior trees so long-running
  // scenarios can run unattended.
  playerAutoAI: boolean
  // Multiplies effective game speed beyond the normal 4× cap.
  superSpeed: number
  logNpcs: boolean
  // npcSystem logs every BT step for the NPC with this name.
  traceName: string | null
  // True keeps dead NPCs around for diagnostics; default in the headless
  // survive harness.
  keepCorpses: boolean
  moneyGift: number
  skillLevelGift: number
  repGift: number
  togglePanel: () => void
  setPanel: (open: boolean) => void
  setAlwaysHyperspeed: (b: boolean) => void
  setFreezeNeeds: (b: boolean) => void
  setInfiniteFuelSupply: (b: boolean) => void
  setPlayerAutoAI: (b: boolean) => void
  setSuperSpeed: (n: number) => void
  setLogNpcs: (b: boolean) => void
  setTraceName: (name: string | null) => void
  setKeepCorpses: (b: boolean) => void
  setMoneyGift: (n: number) => void
  setSkillLevelGift: (n: number) => void
  setRepGift: (n: number) => void
}

export const useDebug = create<DebugState>((set) => ({
  panelOpen: false,
  alwaysHyperspeed: false,
  freezeNeeds: false,
  infiniteFuelSupply: false,
  playerAutoAI: false,
  superSpeed: 1,
  logNpcs: false,
  traceName: null,
  keepCorpses: false,
  moneyGift: 100_000,
  skillLevelGift: 5,
  repGift: 1000,
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  setPanel: (open) => set({ panelOpen: open }),
  setAlwaysHyperspeed: (b) => set({ alwaysHyperspeed: b }),
  setFreezeNeeds: (b) => set({ freezeNeeds: b }),
  setInfiniteFuelSupply: (b) => set({ infiniteFuelSupply: b }),
  setPlayerAutoAI: (b) => set({ playerAutoAI: b }),
  setSuperSpeed: (n) => set({ superSpeed: Math.max(1, n) }),
  setLogNpcs: (b) => set({ logNpcs: b }),
  setTraceName: (name) => set({ traceName: name }),
  setKeepCorpses: (b) => set({ keepCorpses: b }),
  setMoneyGift: (n) => set({ moneyGift: Number.isFinite(n) ? n : 0 }),
  setSkillLevelGift: (n) => set({ skillLevelGift: Number.isFinite(n) ? n : 0 }),
  setRepGift: (n) => set({ repGift: Number.isFinite(n) ? n : 0 }),
}))

// Console hooks for fast sim runs and verbose logging.
if (typeof window !== 'undefined') {
  ;(window as unknown as { uclifeDebug: unknown }).uclifeDebug = {
    superSpeed: (n: number) => useDebug.getState().setSuperSpeed(n),
    logNpcs: (b = true) => useDebug.getState().setLogNpcs(b),
    state: () => useDebug.getState(),
  }
}
