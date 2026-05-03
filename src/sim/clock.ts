import { create } from 'zustand'

export type Speed = 0 | 1 | 2 | 4
// 'combat' is bridge-mode (Phase 6 FTL-shape combat); the loop scales per-
// frame minutes down so 1 real-second is ~1 game-second under it. See
// Design/combat.md "Bridge mode" and src/sim/loop.ts.
export type Mode = 'normal' | 'committed' | 'combat'

interface ClockState {
  gameDate: Date
  speed: Speed
  mode: Mode
  forceHyperspeed: boolean
  setSpeed: (s: Speed) => void
  setMode: (m: Mode) => void
  setForceHyperspeed: (b: boolean) => void
  advance: (minutes: number) => void
  reset: () => void
}

export function startDate(): Date {
  const d = new Date()
  d.setFullYear(77, 3, 27)
  d.setHours(9, 0, 0, 0)
  return d
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

// 1-based day count since the campaign began. Rollover at calendar midnight
// game-time, not 24h after spawn — start day = day 1 even though the player
// wakes at 09:00.
export function gameDayNumber(d: Date): number {
  const start = startDate()
  start.setHours(0, 0, 0, 0)
  const dayStart = new Date(d)
  dayStart.setHours(0, 0, 0, 0)
  return Math.floor((dayStart.getTime() - start.getTime()) / MS_PER_DAY) + 1
}

export const useClock = create<ClockState>((set) => ({
  gameDate: startDate(),
  speed: 1,
  mode: 'normal',
  forceHyperspeed: false,
  setSpeed: (speed) => set({ speed }),
  setMode: (mode) => set({ mode }),
  setForceHyperspeed: (forceHyperspeed) => set({ forceHyperspeed }),
  advance: (minutes) => set((s) => {
    const d = new Date(s.gameDate)
    d.setMinutes(d.getMinutes() + minutes)
    return { gameDate: d }
  }),
  reset: () => set({ gameDate: startDate(), speed: 1, mode: 'normal', forceHyperspeed: false }),
}))

const DOW = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

export function formatUC(d: Date): string {
  const yyyy = d.getFullYear().toString().padStart(4, '0')
  const mm = (d.getMonth() + 1).toString().padStart(2, '0')
  const dd = d.getDate().toString().padStart(2, '0')
  const hh = d.getHours().toString().padStart(2, '0')
  const mn = d.getMinutes().toString().padStart(2, '0')
  return `UC ${yyyy}.${mm}.${dd} ${DOW[d.getDay()]} ${hh}:${mn}`
}
