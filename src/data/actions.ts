import type { ActionKind, InteractableKind } from '../config/kinds'
import { actionsConfig } from '../config'

export type ActionDef = {
  kind: ActionKind
  durationMin: number
}

// transit/ticketCounter open UI overlays rather than committing to an
// action, so they're excluded alongside shop/HR/manager. Clinic and
// pharmacy are in the same UI-overlay bucket — interactionSystem
// dispatches ui:open-dialog-npc and the doctor / pharmacist's inline
// conversation extension renders the actual options.
type ActionableInteractableKind = Exclude<InteractableKind, 'shop' | 'hr' | 'manager' | 'secretary' | 'aeReception' | 'clinic' | 'pharmacy' | 'transit' | 'ticketCounter' | 'buyShip' | 'boardShip' | 'disembarkShip' | 'helm'>

// Durations here are defaults — interaction.ts overrides at runtime for
// sleep/bar/work.
export const ACTIONS: Record<ActionableInteractableKind, ActionDef> = {
  eat:      { kind: 'eating',     durationMin: actionsConfig.defaults.eat },
  sleep:    { kind: 'sleeping',   durationMin: actionsConfig.defaults.sleep },
  wash:     { kind: 'washing',    durationMin: actionsConfig.defaults.wash },
  work:     { kind: 'working',    durationMin: actionsConfig.defaults.work },
  bar:      { kind: 'reveling',   durationMin: actionsConfig.defaults.bar },
  // Survival fallbacks — same action kinds as paid versions, but vitals.ts
  // reads RoughUse on the actor to apply hygiene + HP penalties.
  tap:      { kind: 'drinking',   durationMin: actionsConfig.defaults.tap },
  scavenge: { kind: 'eating',     durationMin: actionsConfig.defaults.scavenge },
  rough:    { kind: 'sleeping',   durationMin: actionsConfig.defaults.rough },
  gym:      { kind: 'exercising', durationMin: actionsConfig.defaults.gym },
}

export const READING_DURATION_MIN = actionsConfig.inventory.read
export const EATING_DURATION_MIN = actionsConfig.inventory.eat
export const DRINKING_DURATION_MIN = actionsConfig.inventory.drink

export function actionLabel(kind: ActionKind): string {
  switch (kind) {
    case 'eating': return '进餐中'
    case 'drinking': return '饮水中'
    case 'sleeping': return '睡眠中'
    case 'washing': return '洗漱中'
    case 'walking': return '行走中'
    case 'working': return '工作中'
    case 'reading': return '阅读中'
    case 'reveling': return '酒吧中'
    case 'chatting': return '聊天中'
    case 'exercising': return '锻炼中'
    default: return ''
  }
}
