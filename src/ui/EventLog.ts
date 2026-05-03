import { create } from 'zustand'
import { useClock } from '../sim/clock'

export interface LogEntry {
  id: number
  gameMs: number
  textZh: string
}

interface EventLogState {
  entries: LogEntry[]
  push: (textZh: string, gameMs: number) => void
  clear: () => void
}

const MAX_ENTRIES = 50

let counter = 0

// Per-session event log for diegetic narrative beats — ambition stage payoffs
// today, future systems later. Not persisted to save in 5.0; reload starts a
// fresh log. Capped at MAX_ENTRIES (FIFO trim) to bound memory.
export const useEventLog = create<EventLogState>((set) => ({
  entries: [],
  push: (textZh, gameMs) => set((s) => {
    const id = ++counter
    const next = [...s.entries, { id, gameMs, textZh }]
    if (next.length > MAX_ENTRIES) next.splice(0, next.length - MAX_ENTRIES)
    return { entries: next }
  }),
  clear: () => set({ entries: [] }),
}))

// Convenience for non-React callsites that don't need to thread the current
// game-time through (encounter outcomes, future combat log lines). Reads
// gameDate from the clock store at call time.
export function logEvent(textZh: string): void {
  const ms = useClock.getState().gameDate.getTime()
  useEventLog.getState().push(textZh, ms)
}
