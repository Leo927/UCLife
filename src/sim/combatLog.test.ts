// Phase 6.0 — combat event log behavior. Routine status changes route
// through useCombatLog instead of pausing tactical; the visible scroll
// is capped at combatConfig.logMaxEntries so a long engagement can't
// unbounded-grow the in-memory ringbuffer. clear() runs at startCombat
// so every fresh engagement starts with an empty log.

import { describe, expect, it, beforeEach } from 'vitest'
import { useCombatLog, pushCombatLog } from './combatLog'
import { combatConfig } from '../config'

beforeEach(() => {
  useCombatLog.getState().clear()
})

describe('combat event log', () => {
  it('pushes entries with their severity tier and a monotonically growing id', () => {
    pushCombatLog('首次接触', 'crit')
    pushCombatLog('击毁敌舰', 'info')
    const { entries } = useCombatLog.getState()
    expect(entries).toHaveLength(2)
    expect(entries[0].severity).toBe('crit')
    expect(entries[1].severity).toBe('info')
    expect(entries[1].id).toBeGreaterThan(entries[0].id)
  })

  it('caps the in-memory scroll at logMaxEntries (oldest evicted first)', () => {
    const cap = combatConfig.logMaxEntries
    for (let i = 0; i < cap + 5; i++) pushCombatLog(`event ${i}`, 'info')
    const { entries } = useCombatLog.getState()
    expect(entries).toHaveLength(cap)
    expect(entries[0].textZh).toBe('event 5')
    expect(entries[cap - 1].textZh).toBe(`event ${cap + 4}`)
  })

  it('clear() empties the scroll and resets the history panel toggle', () => {
    pushCombatLog('x', 'info')
    useCombatLog.getState().setHistoryOpen(true)
    useCombatLog.getState().clear()
    const s = useCombatLog.getState()
    expect(s.entries).toHaveLength(0)
    expect(s.historyOpen).toBe(false)
  })

  it('toggleHistory flips the historyOpen flag', () => {
    expect(useCombatLog.getState().historyOpen).toBe(false)
    useCombatLog.getState().toggleHistory()
    expect(useCombatLog.getState().historyOpen).toBe(true)
    useCombatLog.getState().toggleHistory()
    expect(useCombatLog.getState().historyOpen).toBe(false)
  })
})
