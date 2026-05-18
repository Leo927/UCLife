// User-preference store for the portrait subsystem. Lives in localStorage
// rather than the save bundle — preferences are per-device, not per-save.

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface PortraitPrefsState {
  portraitProvider: string
  setPortraitProvider: (id: string) => void
}

export const usePortraitPrefs = create<PortraitPrefsState>()(
  persist(
    (set) => ({
      portraitProvider: 'fc-pregmod',
      setPortraitProvider: (id) => set({ portraitProvider: id }),
    }),
    { name: 'uclife-portrait-prefs' },
  ),
)
