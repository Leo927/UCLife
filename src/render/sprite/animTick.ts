// 12 Hz matches the LPC reference rate; walk cycle's 8 frames ≈ 0.66s/step.

import { create } from 'zustand'

interface TickState {
  tick: number
}

export const useAnimTick = create<TickState>(() => ({ tick: 0 }))

const HZ = 12
let started = false

export function startAnimTicker(): void {
  if (started) return
  started = true
  if (typeof window === 'undefined') return
  setInterval(() => {
    useAnimTick.setState((s) => ({ tick: s.tick + 1 }))
  }, Math.round(1000 / HZ))
}
