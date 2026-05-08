import type { Entity, TraitInstance, World } from 'koota'
import { State } from 'mistreevous'
import type { Agent, ActionResult } from 'mistreevous/dist/Agent'
import { Action, Active, MoveTarget, Path, Position, Vitals, Money, Inventory, Job, Home, RoughUse, ChatTarget, ChatLine, WanderState, Character, Health, Knows } from '../ecs/traits'
import { isPointInActiveZone } from '../systems/activeZone'
import type { ActionKind, RoughKind } from '../ecs/traits'
import { tierOf } from '../systems/relations'
import { pickChatLine } from '../character/chatLines'
import { getLandmark, getNearestRoughSource, getRoughSources, isInsideShop } from '../data/landmarks'
import { useClock } from '../sim/clock'
import { isShopOpen, isBarOpen } from '../systems/shop'
import {
  findBestOpenJob, claimJob, isWorkstationOpen,
  findBestOpenBed, claimHome,
} from '../systems/market'
import {
  getClaimedBarSeatFor, findFreeBarSeat, claimBarSeat, releaseBarSeatFor,
  getClaimedBarSeatPos,
} from '../systems/barSeats'
import {
  findNearestFreeRoughSpot, claimRoughSpot, releaseRoughSpotFor,
  getClaimedRoughSpotFor, getClaimedRoughSpotPos,
} from '../systems/roughSpots'
import { aiConfig, economyConfig, worldConfig, actionsConfig } from '../config'
import { feedUse } from '../systems/attributes'
import { useDebug } from '../debug/store'

const ARRIVE_DIST = worldConfig.ranges.npcArrive
const COUNTER_DIST = worldConfig.ranges.npcCounter
const CHAT = actionsConfig.chatting

// Vital crosses GoTo → fix it; vital drops to Resolved → BT moves on.
const {
  fatigueGoHome: FATIGUE_GO_HOME, fatigueRested: FATIGUE_RESTED,
  hungerGoHome:  HUNGER_GO_HOME,  hungerFed:     HUNGER_FED,
  thirstGoHome:  THIRST_GO_HOME,  thirstQuenched: THIRST_QUENCHED,
  hygieneGoHome: HYGIENE_GO_HOME, hygieneClean:   HYGIENE_CLEAN,
  boredomGoToBar: BOREDOM_GO_TO_BAR, boredomFulfilled: BOREDOM_FULFILLED,
} = aiConfig.drives

const STOCK_TARGET_MEAL = aiConfig.stockTarget.meal
const STOCK_TARGET_PREMIUM = aiConfig.stockTarget.premiumMeal
const STOCK_TARGET_WATER = aiConfig.stockTarget.water

const WEALTHY_CASH = aiConfig.livingStandards.wealthyCash
const DESTITUTE_CASH = aiConfig.livingStandards.destituteCash

const MEAL_PRICE = economyConfig.prices.meal
const PREMIUM_MEAL_PRICE = economyConfig.prices.premiumMeal
const WATER_PRICE = economyConfig.prices.water
const BAR_PRICE = economyConfig.prices.barDrink

export type NPCAgent = Agent & {
  // Per-step trait snapshot. Conditions in this BT each read at least one
  // trait and Vitals is read by 5 conditions per step — dedup-on-step is
  // worth ~5× for hot traits at the cost of a single small refresh.
  refreshContext: () => void
  isExhausted: () => boolean
  isHungry: () => boolean
  isThirsty: () => boolean
  isDirty: () => boolean
  isBored: () => boolean
  needsJob: () => boolean
  needsHome: () => boolean
  shouldWork: () => boolean
  hasMeal: () => boolean
  hasWater: () => boolean
  canBuyMeal: () => boolean
  canBuyWater: () => boolean
  canAffordBar: () => boolean
  shouldStockUp: () => boolean
  isHomeless: () => boolean
  isDestitute: () => boolean
  hasTap: () => boolean
  hasTrash: () => boolean
  hasRoughSpot: () => boolean
  findJob: () => ActionResult
  findHome: () => ActionResult
  goHome: () => ActionResult
  goToWork: () => ActionResult
  goToShop: () => ActionResult
  walkToBarSeat: () => ActionResult
  goToTap: () => ActionResult
  goToTrash: () => ActionResult
  goToRoughSpot: () => ActionResult
  sleep: () => ActionResult
  sleepRough: () => ActionResult
  eat: () => ActionResult
  scavenge: () => ActionResult
  drink: () => ActionResult
  drinkAtTap: () => ActionResult
  wash: () => ActionResult
  work: () => ActionResult
  buyMeal: () => ActionResult
  buyWater: () => ActionResult
  stockUp: () => ActionResult
  leaveShopCounter: () => ActionResult
  revel: () => ActionResult
  idleAtHome: () => ActionResult
  chat: () => ActionResult
  wander: () => ActionResult
}

export function makeNPCAgent(world: World, entity: Entity): NPCAgent {
  // Stays `undefined` for traits the entity hasn't been given yet (e.g. a
  // freshly-spawned immigrant before setupWorld stamps Vitals); each condition
  // guards its own access. Actions skip ctx since they may run for many ticks
  // (RUNNING state) and prefer fresh data per evaluation.
  const ctx: {
    vitals?: TraitInstance<typeof Vitals>
    inv?: TraitInstance<typeof Inventory>
    money?: TraitInstance<typeof Money>
    action?: TraitInstance<typeof Action>
    pos?: TraitInstance<typeof Position>
  } = {}

  const refreshContext = (): void => {
    ctx.vitals = entity.get(Vitals)
    ctx.inv = entity.get(Inventory)
    ctx.money = entity.get(Money)
    ctx.action = entity.get(Action)
    ctx.pos = entity.get(Position)
  }

  const workstation = (): Entity | null => {
    const j = entity.get(Job)
    return j?.workstation ?? null
  }

  const homeBed = (): Entity | null => {
    const h = entity.get(Home)
    return h?.bed ?? null
  }

  const workLoc = (): { x: number; y: number } | null => {
    const ws = workstation()
    if (!ws) return null
    return ws.get(Position) ?? null
  }

  const homeLoc = (): { x: number; y: number } | null => {
    const bed = homeBed()
    if (!bed) return null
    return bed.get(Position) ?? null
  }

  // Self-serve exception: when a clerk self-interrupts work to eat or drink,
  // the shop reads as "closed" (no one 'working' at the counter), which would
  // otherwise block them from buying their own stock.
  const isShopWorker = () => {
    const loc = workLoc()
    if (!loc) return false
    const counter = getLandmark('shopCounter')
    return Math.hypot(loc.x - counter.x, loc.y - counter.y) < 6
  }

  const distTo = (loc: { x: number; y: number } | null) => {
    if (!loc) return Infinity
    const p = entity.get(Position)
    if (!p) return Infinity
    return Math.hypot(p.x - loc.x, p.y - loc.y)
  }
  const setMoveTarget = (x: number, y: number) => {
    // Inactive teleport shortcut: when both source and destination are
    // off-camera, skip the per-frame A* walk and place the NPC directly.
    // Active NPCs always walk so the player sees motion; transitions are
    // handled by the membership tick.
    if (!entity.has(Active)) {
      const pos = entity.get(Position)
      if (pos && !isPointInActiveZone(world, pos.x, pos.y) && !isPointInActiveZone(world, x, y)) {
        entity.set(Position, { x, y })
        if (entity.has(MoveTarget)) entity.remove(MoveTarget)
        if (entity.has(Path)) entity.remove(Path)
        const a = entity.get(Action)
        if (a?.kind === 'walking') entity.set(Action, { ...a, kind: 'idle' })
        return
      }
    }
    // koota's `entity.set()` writes to the trait store but does NOT add the
    // trait to the entity's mask, so calling .set on a removed trait leaves
    // the NPC invisible to movementSystem's query.
    const t = entity.get(MoveTarget)
    if (!t) entity.add(MoveTarget({ x, y }))
    else if (t.x !== x || t.y !== y) entity.set(MoveTarget, { x, y })
  }
  const setActionKind = (kind: ActionKind) => {
    const a = entity.get(Action)
    if (a && a.kind !== kind) entity.set(Action, { ...a, kind })
  }

  // try/catch: entity may be destroyed mid-step (corpse cleanup under
  // setKeepCorpses=false fires from vitalsSystem's death branch).
  const setRoughUse = (kind: RoughKind) => {
    try {
      if (entity.has(RoughUse)) entity.set(RoughUse, { kind })
      else entity.add(RoughUse({ kind }))
    } catch { /* destroyed mid-step */ }
  }
  const releaseCommitted = () => {
    const a = entity.get(Action)
    if (!a) return
    if (a.kind === 'idle' || a.kind === 'walking') return
    entity.set(Action, { ...a, kind: 'idle' })
  }

  // True when the pathfinder reported "no route" — movement clears
  // `path.waypoints` to an empty array when findPath returns nothing. Lets
  // travel actions surface FAILED so the BT can fall through to a lower-
  // priority branch instead of looping RUNNING forever.
  const isPathBlocked = (tx: number, ty: number): boolean => {
    const path = entity.get(Path)
    if (!path) return false
    if (path.targetX !== tx || path.targetY !== ty) return false
    return path.waypoints.length === 0
  }

  return {
    refreshContext,
    isExhausted() {
      const v = ctx.vitals
      return !!v && v.fatigue >= FATIGUE_GO_HOME
    },
    isHungry() {
      const v = ctx.vitals
      return !!v && v.hunger >= HUNGER_GO_HOME
    },
    isThirsty() {
      const v = ctx.vitals
      return !!v && v.thirst >= THIRST_GO_HOME
    },
    isDirty() {
      const v = ctx.vitals
      return !!v && v.hygiene >= HYGIENE_GO_HOME
    },
    isBored() {
      const v = ctx.vitals
      return !!v && v.boredom >= BOREDOM_GO_TO_BAR
    },
    hasMeal() {
      const inv = ctx.inv
      return !!inv && (inv.meal > 0 || inv.premiumMeal > 0)
    },
    hasWater() {
      const inv = ctx.inv
      return !!inv && inv.water > 0
    },
    canBuyMeal() {
      if (!isShopOpen(world) && !isShopWorker()) return false
      const m = ctx.money
      return !!m && m.amount >= MEAL_PRICE
    },
    canBuyWater() {
      if (!isShopOpen(world) && !isShopWorker()) return false
      const m = ctx.money
      return !!m && m.amount >= WATER_PRICE
    },
    canAffordBar() {
      if (!isBarOpen(world)) return false
      const m = ctx.money
      return !!m && m.amount >= BAR_PRICE
    },
    shouldStockUp() {
      const ws = workstation()
      if (ws && isWorkstationOpen(ws, useClock.getState().gameDate)) return false
      const inv = ctx.inv
      const m = ctx.money
      if (!inv || !m) return false
      const lowMeal = inv.meal < STOCK_TARGET_MEAL
      const lowWater = inv.water < STOCK_TARGET_WATER
      const wealthy = m.amount >= WEALTHY_CASH
      const lowPremium = wealthy && inv.premiumMeal < STOCK_TARGET_PREMIUM
      if (!lowMeal && !lowWater && !lowPremium) return false
      return isShopOpen(world) && m.amount >= MEAL_PRICE + WATER_PRICE
    },

    needsJob() {
      return workstation() === null
    },

    isHomeless() {
      return homeBed() === null
    },
    // Survival fallbacks (scavenge, rough sleep) are gated on this so wealthy
    // NPCs don't pick a hygiene-poisoning trash meal or a HP-bleeding park
    // bench when the shop is between shifts or every bed is rented out — they
    // wait, walk, or call findHome instead. Below DESTITUTE_CASH the
    // fallbacks are the only option, so we let them fire.
    isDestitute() {
      const m = ctx.money
      return !m || m.amount <= DESTITUTE_CASH
    },
    hasTap() {
      const p = ctx.pos
      return !!p && getNearestRoughSource('tap', p) !== null
    },
    hasTrash() {
      const p = ctx.pos
      return !!p && getNearestRoughSource('scavenge', p) !== null
    },
    hasRoughSpot() {
      if (getClaimedRoughSpotFor(world, entity) !== null) return true
      const p = ctx.pos
      return !!p && findNearestFreeRoughSpot(world, p) !== null
    },

    needsHome() {
      return homeBed() === null
    },

    shouldWork() {
      // Work is the always-on baseline drive — no single-tick state check
      // can predict the continuous money need. Higher-priority drives
      // (sleep/drink/eat/wash) preempt via BT ordering above this branch.
      const ws = workstation()
      if (!ws) return false
      return isWorkstationOpen(ws, useClock.getState().gameDate)
    },

    findJob() {
      if (workstation()) return State.SUCCEEDED
      const ws = findBestOpenJob(world, entity)
      if (!ws) return State.FAILED
      return claimJob(world, entity, ws) ? State.SUCCEEDED : State.FAILED
    },

    findHome() {
      if (homeBed()) return State.SUCCEEDED
      const m = entity.get(Money)
      const cash = m?.amount ?? 0
      const bed = findBestOpenBed(world, entity, cash)
      if (!bed) return State.FAILED
      return claimHome(world, entity, bed) ? State.SUCCEEDED : State.FAILED
    },

    goHome() {
      const tgt = homeLoc()
      if (!tgt) return State.FAILED
      releaseCommitted()
      setMoveTarget(tgt.x, tgt.y)
      if (distTo(tgt) <= ARRIVE_DIST) return State.SUCCEEDED
      if (isPathBlocked(tgt.x, tgt.y)) return State.FAILED
      return State.RUNNING
    },

    goToWork() {
      const tgt = workLoc()
      if (!tgt) return State.FAILED
      releaseCommitted()
      setMoveTarget(tgt.x, tgt.y)
      if (distTo(tgt) <= ARRIVE_DIST) return State.SUCCEEDED
      if (isPathBlocked(tgt.x, tgt.y)) return State.FAILED
      return State.RUNNING
    },

    goToShop() {
      releaseCommitted()
      // Shop is one-way: north door entry-only, south door exit-only.
      // Buyers path to shopApproach (south of counter, where the cashier
      // isn't anchored) via shopEntry — without the waypoint, A* routes
      // south-side buyers in through the exit door and collides with leavers.
      const approach = getLandmark('shopApproach')
      if (distTo(approach) <= COUNTER_DIST) return State.SUCCEEDED
      const pos = entity.get(Position)!
      if (isInsideShop(pos)) {
        setMoveTarget(approach.x, approach.y)
        if (isPathBlocked(approach.x, approach.y)) return State.FAILED
        return State.RUNNING
      }
      const entry = getLandmark('shopEntry')
      const tgt = distTo(entry) > ARRIVE_DIST ? entry : approach
      setMoveTarget(tgt.x, tgt.y)
      if (isPathBlocked(tgt.x, tgt.y)) return State.FAILED
      return State.RUNNING
    },

    walkToBarSeat() {
      releaseCommitted()
      let seatPos = getClaimedBarSeatPos(world, entity)
      if (!seatPos) {
        // Pass the requester so seat scoring biases toward friends and away
        // from rivals.
        const seat = findFreeBarSeat(world, entity)
        if (seat && claimBarSeat(world, entity, seat)) {
          seatPos = seat.get(Position) ?? null
        } else {
          const queue = getLandmark('barQueue')
          setMoveTarget(queue.x, queue.y)
          if (isPathBlocked(queue.x, queue.y)) return State.FAILED
          return State.RUNNING
        }
      }
      if (!seatPos) return State.FAILED
      setMoveTarget(seatPos.x, seatPos.y)
      if (distTo(seatPos) <= ARRIVE_DIST) return State.SUCCEEDED
      if (isPathBlocked(seatPos.x, seatPos.y)) return State.FAILED
      return State.RUNNING
    },

    sleep() {
      const v = entity.get(Vitals)
      if (!v) return State.FAILED
      if (v.fatigue <= FATIGUE_RESTED) {
        setActionKind('idle')
        return State.SUCCEEDED
      }
      // Critical-need self-interrupt — without it, mistreevous's sticky
      // sequences keep sleep RUNNING and the NPC dies with food in inventory.
      // Must return FAILED (not SUCCEEDED): sleep is the highest-priority
      // branch, so SUCCEEDED would loop right back here on next tick.
      if (v.hunger >= 95 || v.thirst >= 95) {
        setActionKind('idle')
        return State.FAILED
      }
      setActionKind('sleeping')
      return State.RUNNING
    },

    // Premium meals are consumed first so the wealthy work through their
    // luxury stock before their basics; they also feed a small Charisma bonus.
    eat() {
      const v = entity.get(Vitals)
      const inv = entity.get(Inventory)
      if (!v || !inv) return State.FAILED
      if (v.hunger <= HUNGER_FED) {
        if (inv.premiumMeal > 0) {
          entity.set(Inventory, { ...inv, premiumMeal: inv.premiumMeal - 1 })
          // gameMinutes=1: this is a one-shot per-meal feed, not a per-tick rate.
          feedUse(entity, 'charisma', actionsConfig.premiumMealCharismaFeed, 1)
        } else if (inv.meal > 0) {
          entity.set(Inventory, { ...inv, meal: inv.meal - 1 })
        }
        setActionKind('idle')
        return State.SUCCEEDED
      }
      if (inv.meal <= 0 && inv.premiumMeal <= 0) return State.FAILED
      setActionKind('eating')
      return State.RUNNING
    },

    drink() {
      const v = entity.get(Vitals)
      const inv = entity.get(Inventory)
      if (!v || !inv) return State.FAILED
      if (v.thirst <= THIRST_QUENCHED) {
        if (inv.water > 0) entity.set(Inventory, { ...inv, water: inv.water - 1 })
        setActionKind('idle')
        return State.SUCCEEDED
      }
      if (inv.water <= 0) return State.FAILED
      setActionKind('drinking')
      return State.RUNNING
    },

    goToTap() {
      const p = entity.get(Position)
      if (!p) return State.FAILED
      const tgt = getNearestRoughSource('tap', p)
      if (!tgt) return State.FAILED
      releaseCommitted()
      setMoveTarget(tgt.x, tgt.y)
      if (distTo(tgt) <= ARRIVE_DIST) return State.SUCCEEDED
      if (isPathBlocked(tgt.x, tgt.y)) return State.FAILED
      return State.RUNNING
    },

    // RoughUse tag adds the public-water hygiene + HP penalty on top of the
    // standard `drinking` action.
    drinkAtTap() {
      const v = entity.get(Vitals)
      if (!v) return State.FAILED
      if (v.thirst <= THIRST_QUENCHED) {
        setActionKind('idle')
        return State.SUCCEEDED
      }
      setRoughUse('tap')
      setActionKind('drinking')
      return State.RUNNING
    },

    goToTrash() {
      const p = entity.get(Position)
      if (!p) return State.FAILED
      const tgt = getNearestRoughSource('scavenge', p)
      if (!tgt) return State.FAILED
      releaseCommitted()
      setMoveTarget(tgt.x, tgt.y)
      if (distTo(tgt) <= ARRIVE_DIST) return State.SUCCEEDED
      if (isPathBlocked(tgt.x, tgt.y)) return State.FAILED
      return State.RUNNING
    },

    // RoughUse cuts hunger reduction to 50% and adds hygiene + HP drain.
    scavenge() {
      const v = entity.get(Vitals)
      if (!v) return State.FAILED
      if (v.hunger <= HUNGER_FED) {
        setActionKind('idle')
        return State.SUCCEEDED
      }
      setRoughUse('scavenge')
      setActionKind('eating')
      return State.RUNNING
    },

    // Bench spots are exclusive — one sleeper each. FAIL on none-free so the
    // BT falls through rather than queueing in front of an occupied bench.
    goToRoughSpot() {
      releaseCommitted()
      let spotPos = getClaimedRoughSpotPos(world, entity)
      if (!spotPos) {
        const p = entity.get(Position)
        if (!p) return State.FAILED
        const spot = findNearestFreeRoughSpot(world, p)
        if (!spot || !claimRoughSpot(world, entity, spot)) return State.FAILED
        spotPos = spot.get(Position) ?? null
      }
      if (!spotPos) return State.FAILED
      setMoveTarget(spotPos.x, spotPos.y)
      if (distTo(spotPos) <= ARRIVE_DIST) return State.SUCCEEDED
      if (isPathBlocked(spotPos.x, spotPos.y)) {
        releaseRoughSpotFor(world, entity)
        return State.FAILED
      }
      return State.RUNNING
    },

    sleepRough() {
      const v = entity.get(Vitals)
      if (!v) return State.FAILED
      if (getClaimedRoughSpotFor(world, entity) === null) return State.FAILED
      if (v.fatigue <= FATIGUE_RESTED) {
        releaseRoughSpotFor(world, entity)
        setActionKind('idle')
        return State.SUCCEEDED
      }
      if (v.hunger >= 95 || v.thirst >= 95) {
        releaseRoughSpotFor(world, entity)
        setActionKind('idle')
        return State.FAILED
      }
      setRoughUse('rough')
      setActionKind('sleeping')
      return State.RUNNING
    },

    wash() {
      const v = entity.get(Vitals)
      if (!v) return State.FAILED
      if (v.hygiene <= HYGIENE_CLEAN) {
        setActionKind('idle')
        return State.SUCCEEDED
      }
      setActionKind('washing')
      return State.RUNNING
    },

    work() {
      const ws = workstation()
      if (!ws) return State.FAILED
      if (!isWorkstationOpen(ws, useClock.getState().gameDate)) {
        setActionKind('idle')
        return State.SUCCEEDED
      }
      // mistreevous sequences are sticky, so higher-priority drives won't
      // preempt work mid-shift via BT structure alone. SUCCEEDED unwinds the
      // sequence and lets the next tick re-evaluate from the top.
      const v = entity.get(Vitals)
      if (v) {
        if (v.hunger >= HUNGER_GO_HOME) { setActionKind('idle'); return State.SUCCEEDED }
        if (v.thirst >= THIRST_GO_HOME) { setActionKind('idle'); return State.SUCCEEDED }
        if (v.fatigue >= FATIGUE_GO_HOME) { setActionKind('idle'); return State.SUCCEEDED }
      }
      setActionKind('working')
      return State.RUNNING
    },

    buyMeal() {
      if (!isShopOpen(world) && !isShopWorker()) return State.FAILED
      if (!isShopWorker() && distTo(getLandmark('shopApproach')) > COUNTER_DIST) return State.FAILED
      const m = entity.get(Money)
      const inv = entity.get(Inventory)
      if (!m || !inv) return State.FAILED
      if (m.amount < MEAL_PRICE) return State.FAILED
      entity.set(Money, { amount: m.amount - MEAL_PRICE })
      entity.set(Inventory, { ...inv, meal: inv.meal + 1 })
      return State.SUCCEEDED
    },

    buyWater() {
      if (!isShopOpen(world) && !isShopWorker()) return State.FAILED
      if (!isShopWorker() && distTo(getLandmark('shopApproach')) > COUNTER_DIST) return State.FAILED
      const m = entity.get(Money)
      const inv = entity.get(Inventory)
      if (!m || !inv) return State.FAILED
      if (m.amount < WATER_PRICE) return State.FAILED
      entity.set(Money, { amount: m.amount - WATER_PRICE })
      entity.set(Inventory, { ...inv, water: inv.water + 1 })
      return State.SUCCEEDED
    },

    // Without this exit step, post-buy anchoring (eat/drink) fires in place
    // at shopApproach and the 18-px body separation pushes the next shopper
    // out of the 6-px buy radius — queue stalls and blocks the south door.
    leaveShopCounter() {
      if (isShopWorker()) return State.SUCCEEDED
      const exit = getLandmark('shopExit')
      releaseCommitted()
      setMoveTarget(exit.x, exit.y)
      if (distTo(exit) <= ARRIVE_DIST) return State.SUCCEEDED
      if (isPathBlocked(exit.x, exit.y)) return State.FAILED
      return State.RUNNING
    },

    stockUp() {
      if (!isShopOpen(world)) return State.FAILED
      if (!isShopWorker() && distTo(getLandmark('shopApproach')) > COUNTER_DIST) return State.FAILED
      const m = entity.get(Money)
      const inv = entity.get(Inventory)
      if (!m || !inv) return State.FAILED
      let money = m.amount
      let meals = inv.meal
      let premiums = inv.premiumMeal
      let waters = inv.water
      let bought = false
      // wantPremium re-checks WEALTHY_CASH per iteration so a partial top-up
      // can't drain a near-broke NPC past their last basic-needs cushion.
      while (true) {
        const wantPremium = money >= WEALTHY_CASH
          && premiums < STOCK_TARGET_PREMIUM
          && money >= PREMIUM_MEAL_PRICE
        const wantMeal = meals < STOCK_TARGET_MEAL && money >= MEAL_PRICE
        const wantWater = waters < STOCK_TARGET_WATER && money >= WATER_PRICE
        if (!wantPremium && !wantMeal && !wantWater) break
        if (wantPremium) { premiums += 1; money -= PREMIUM_MEAL_PRICE; bought = true }
        if (wantMeal) { meals += 1; money -= MEAL_PRICE; bought = true }
        if (wantWater) { waters += 1; money -= WATER_PRICE; bought = true }
      }
      if (!bought) return State.FAILED
      entity.set(Money, { amount: money })
      entity.set(Inventory, { ...inv, meal: meals, premiumMeal: premiums, water: waters })
      return State.SUCCEEDED
    },

    revel() {
      const v = entity.get(Vitals)
      if (!v) return State.FAILED
      if (v.boredom <= BOREDOM_FULFILLED) {
        releaseBarSeatFor(world, entity)
        setActionKind('idle')
        return State.SUCCEEDED
      }
      const a = entity.get(Action)
      if (a?.kind !== 'reveling') {
        if (!isBarOpen(world)) {
          releaseBarSeatFor(world, entity)
          return State.FAILED
        }
        const seat = getClaimedBarSeatFor(world, entity)
        if (!seat) return State.FAILED
        const seatPos = seat.get(Position)
        if (!seatPos || distTo(seatPos) > ARRIVE_DIST) return State.FAILED
        const m = entity.get(Money)
        if (!m || m.amount < BAR_PRICE) {
          releaseBarSeatFor(world, entity)
          return State.FAILED
        }
        entity.set(Money, { amount: m.amount - BAR_PRICE })
        setActionKind('reveling')
      }
      return State.RUNNING
    },

    idleAtHome() {
      // Self-interrupt on any active drive. mistreevous selectors are sticky
      // on RUNNING — without this gate, an NPC walking home would never
      // re-check higher-priority branches (eat/drink/sleep) as their drives
      // saturate, and would starve with food in their inventory. Returning
      // FAILED unwinds the selector and triggers a tree reset on the next
      // tick so the BT re-evaluates from the top.
      const v = entity.get(Vitals)
      if (v && (
        v.fatigue >= FATIGUE_GO_HOME ||
        v.hunger >= HUNGER_GO_HOME ||
        v.thirst >= THIRST_GO_HOME ||
        v.hygiene >= HYGIENE_GO_HOME ||
        v.boredom >= BOREDOM_GO_TO_BAR
      )) {
        return State.FAILED
      }
      releaseCommitted()
      const tgt = homeLoc()
      if (!tgt) return State.SUCCEEDED
      const d = distTo(tgt)
      if (d > ARRIVE_DIST) {
        setMoveTarget(tgt.x, tgt.y)
        if (isPathBlocked(tgt.x, tgt.y)) return State.FAILED
        return State.RUNNING
      }
      setActionKind('idle')
      return State.SUCCEEDED
    },

    // Completion is boredom-driven (not duration) because actionSystem only
    // ticks action.remaining for the player — NPCs drain vitals and exit on
    // threshold. Critical-drive self-interrupt prevents mistreevous selector
    // stickiness from pinning the BT and starving the NPC.
    chat() {
      const releaseChat = () => {
        // try/catch wrapper because koota's .has() can briefly disagree with
        // the store on entities destroyed mid-step.
        let partner: Entity | null = null
        try {
          const t = entity.get(ChatTarget)
          partner = t?.partner ?? null
          if (entity.has(ChatTarget)) entity.remove(ChatTarget)
          if (entity.has(ChatLine)) entity.remove(ChatLine)
          const a = entity.get(Action)
          if (a?.kind === 'chatting') entity.set(Action, { ...a, kind: 'idle', remaining: 0, total: 0 })
        } catch { /* destroyed mid-step */ }
        if (partner) {
          try {
            // Only clear partner's pointer if it still points at us — they
            // may have already abandoned us; don't stomp.
            const pt = partner.get(ChatTarget)
            if (pt?.partner === entity) partner.remove(ChatTarget)
          } catch { /* partner destroyed mid-step */ }
        }
      }

      // Must run BEFORE the in-chat RUNNING return below, otherwise the
      // selector sticks on RUNNING and higher-priority branches never fire.
      const v = entity.get(Vitals)
      if (v) {
        if (v.fatigue >= FATIGUE_GO_HOME) { releaseChat(); return State.FAILED }
        if (v.hunger  >= HUNGER_GO_HOME)  { releaseChat(); return State.FAILED }
        if (v.thirst  >= THIRST_GO_HOME)  { releaseChat(); return State.FAILED }
        if (v.hygiene >= HYGIENE_GO_HOME) { releaseChat(); return State.FAILED }
      }

      const myChat = entity.get(ChatTarget)
      if (myChat && myChat.partner) {
        const partner = myChat.partner

        if (!partner.has(Character) || partner.get(Health)?.dead) {
          releaseChat()
          return State.FAILED
        }
        const pt = partner.get(ChatTarget)
        if (!pt || pt.partner !== entity) {
          releaseChat()
          return State.FAILED
        }

        const ppos = partner.get(Position)
        if (!ppos) {
          releaseChat()
          return State.FAILED
        }

        const a = entity.get(Action)!
        if (a.kind === 'chatting') {
          // Re-check partner distance in case they were dragged away by a
          // higher-priority drive on their side.
          const dist = distTo(ppos)
          if (dist > CHAT.arriveDistPx * 2) {
            releaseChat()
            return State.FAILED
          }
          if (v && v.boredom <= BOREDOM_FULFILLED) {
            releaseChat()
            return State.SUCCEEDED
          }
          return State.RUNNING
        }

        const dist = distTo(ppos)
        if (dist > CHAT.arriveDistPx) {
          releaseCommitted()
          setMoveTarget(ppos.x, ppos.y)
          if (isPathBlocked(ppos.x, ppos.y)) {
            releaseChat()
            return State.FAILED
          }
          return State.RUNNING
        }
        entity.set(Action, { kind: 'chatting', total: CHAT.durationMin, remaining: CHAT.durationMin })
        // Each side picks its line from its own view of the tier — partner
        // picks theirs independently on their next BT tick.
        const myEdge = entity.has(Knows(partner)) ? entity.get(Knows(partner)) : null
        const tier = myEdge ? tierOf(myEdge.opinion, myEdge.familiarity) : 'acquaintance'
        const text = pickChatLine(tier)
        if (entity.has(ChatLine)) entity.set(ChatLine, { text })
        else entity.add(ChatLine({ text }))
        if (useDebug.getState().logNpcs) {
          const myName = entity.get(Character)?.name ?? '?'
          const pName = partner.get(Character)?.name ?? '?'
          // eslint-disable-next-line no-console
          console.log(`[social] ${myName} 与 ${pName} 开始聊天: ${text}`)
        }
        return State.RUNNING
      }

      // Only initiate from clean idle — don't yank ourselves out of work etc.
      const aNow = entity.get(Action)
      if (!aNow || (aNow.kind !== 'idle' && aNow.kind !== 'walking')) return State.FAILED

      if (!v || v.boredom < CHAT.boredomMin) return State.FAILED

      const myPos = entity.get(Position)
      if (!myPos) return State.FAILED

      // Acquaintance-tier or above is enough — friend-tier would mean no
      // chats fire for the first several game-days while the graph builds.
      let pick: Entity | null = null
      const myCharismaTargets = entity.targetsFor(Knows)
      for (const target of myCharismaTargets) {
        const e = entity.get(Knows(target))!
        const tier = tierOf(e.opinion, e.familiarity)
        if (tier !== 'friend' && tier !== 'acquaintance') continue
        if (target.has(ChatTarget)) continue
        if (target.get(Health)?.dead) continue
        const tp = target.get(Position)
        if (!tp) continue
        if (Math.hypot(tp.x - myPos.x, tp.y - myPos.y) > CHAT.inviteRangePx) continue
        const ta = target.get(Action)
        if (!ta || (ta.kind !== 'idle' && ta.kind !== 'walking')) continue
        pick = target
        break
      }
      if (!pick) return State.FAILED

      // Partner's BT detects the trait on its next tick and mirrors the
      // walk-to-partner logic.
      entity.add(ChatTarget({ partner: pick }))
      pick.add(ChatTarget({ partner: entity }))
      return State.RUNNING
    },

    // Always SUCCEEDED — RUNNING would let mistreevous selector-stickiness
    // pin the BT and starve chat() of mid-trip rendezvous opportunities.
    // WanderState then throttles re-picks (20–40 game-min, jittered) so the
    // SUCCEEDED-every-tick loop doesn't re-roll a new destination every step.
    wander() {
      const nowMs = useClock.getState().gameDate.getTime()
      const ws = entity.get(WanderState)
      if (ws && ws.nextPickMs > nowMs) return State.SUCCEEDED

      const myPos = entity.get(Position)
      if (!myPos) return State.SUCCEEDED

      const pool: Array<{ x: number; y: number }> = []
      try { pool.push(getLandmark('barQueue')) } catch { /* not registered yet */ }
      try { pool.push(getLandmark('shopApproach')) } catch { /* */ }
      pool.push(...getRoughSources('tap'))
      pool.push(...getRoughSources('scavenge'))
      pool.push(...getRoughSources('rough'))
      if (pool.length === 0) return State.SUCCEEDED

      const candidates = pool.filter((p) => Math.hypot(p.x - myPos.x, p.y - myPos.y) > 50)
      const choices = candidates.length > 0 ? candidates : pool
      const target = choices[Math.floor(Math.random() * choices.length)]

      releaseCommitted()
      setMoveTarget(target.x, target.y)

      const intervalMin = 20 + Math.random() * 20
      const next = nowMs + intervalMin * 60 * 1000
      try {
        if (entity.has(WanderState)) entity.set(WanderState, { nextPickMs: next })
        else entity.add(WanderState({ nextPickMs: next }))
      } catch { /* destroyed mid-step */ }

      return State.SUCCEEDED
    },
  }
}
