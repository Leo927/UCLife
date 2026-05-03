import { neighborsOf, getNode } from '../data/starmap'
import { getShipState, spendFuel, setDockedNode, getDockedNodeId } from '../sim/ship'
import { useClock } from '../sim/clock'
import { runTransition, useTransition } from '../sim/transition'
import { useUI } from '../ui/uiStore'
import { useEventLog } from '../ui/EventLog'
import { triggerEncounterAtNode } from '../sim/encounters'

// Slice E: starmap jump system. Validates reachability + fuel, runs the
// shared fade transition, and at the midpoint mutates ship/clock state so
// the cover hides the swap. Slice F (encounter dispatch) and Slice K
// (encounter handoff) replace the post-arrival stub.

export type JumpFailReason =
  | 'no-ship'
  | 'not-docked'
  | 'not-neighbor'
  | 'insufficient-fuel'
  | 'in-transition'

export interface JumpResult {
  ok: boolean
  reason?: JumpFailReason
}

export function canJumpTo(nodeId: string): JumpResult {
  if (useTransition.getState().inProgress) return { ok: false, reason: 'in-transition' }
  const ship = getShipState()
  if (!ship) return { ok: false, reason: 'no-ship' }
  const from = getDockedNodeId()
  if (!from) return { ok: false, reason: 'not-docked' }
  const neighbors = neighborsOf(from)
  const hit = neighbors.find((n) => n.node.id === nodeId)
  if (!hit) return { ok: false, reason: 'not-neighbor' }
  if (ship.fuelCurrent < hit.edge.fuelCost) return { ok: false, reason: 'insufficient-fuel' }
  return { ok: true }
}

const FAIL_REASON_MSG: Record<JumpFailReason, string> = {
  'no-ship': '没有飞船',
  'not-docked': '飞船未在节点',
  'not-neighbor': '该节点不在跳跃范围内',
  'insufficient-fuel': '燃料不足',
  'in-transition': '正在跳跃中',
}

export async function jumpTo(nodeId: string): Promise<void> {
  const check = canJumpTo(nodeId)
  if (!check.ok) {
    useUI.getState().showToast(FAIL_REASON_MSG[check.reason!])
    return
  }

  const fromId = getDockedNodeId()!
  const edge = neighborsOf(fromId).find((n) => n.node.id === nodeId)!.edge
  const dest = getNode(nodeId)!
  useUI.getState().setStarmap(false)

  await runTransition({
    midpoint: () => {
      spendFuel(edge.fuelCost)
      useClock.getState().advance(edge.durationMin)
      setDockedNode(nodeId)
      const ms = useClock.getState().gameDate.getTime()
      useEventLog.getState().push(`跳跃到 ${dest.nameZh}`, ms)
      triggerEncounterAtNode(nodeId)
    },
    outMs: 600,
    inMs: 600,
  })
}
