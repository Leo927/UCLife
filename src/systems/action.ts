import type { World, Entity } from 'koota'
import { Action, Skills, Inventory, IsPlayer, Job, Position, Workstation } from '../ecs/traits'
import type { ActionKind } from '../ecs/traits'
import { BOOK_CAP_XP, type SkillId } from '../data/skills'
import { isInWorkWindowWS, getJobSpec } from '../data/jobs'
import { useClock } from '../sim/clock'
import { releaseBarSeatFor } from './barSeats'
import { releaseRoughSpotFor } from './roughSpots'
import { feedUse, statValue } from './attributes'
import { FEED, statMult } from '../data/stats'
import { actionsConfig, worldConfig } from '../config'
import { RoughUse } from '../ecs/traits'

const READ_XP = actionsConfig.reading.xpPerBook
const READ_TARGET_SKILL: SkillId = actionsConfig.reading.targetSkill

const REWARDS: Partial<Record<ActionKind, (entity: Entity) => void>> = {
  reading: (entity) => {
    const inv = entity.get(Inventory)
    const s = entity.get(Skills)
    if (inv && inv.books > 0) entity.set(Inventory, { ...inv, books: inv.books - 1 })
    if (s && s[READ_TARGET_SKILL] < BOOK_CAP_XP) {
      const intMult = statMult(statValue(entity, 'intelligence'))
      const xpGain = Math.round(READ_XP * intMult)
      entity.set(Skills, {
        ...s,
        [READ_TARGET_SKILL]: Math.min(BOOK_CAP_XP, s[READ_TARGET_SKILL] + xpGain),
      })
    }
  },
  eating: (entity) => {
    // Scavenging draws from a dumpster, not inventory.
    const rough = entity.get(RoughUse)
    if (rough?.kind === 'scavenge') return
    const inv = entity.get(Inventory)
    if (!inv) return
    // Charisma feed only on premium — matches the NPC eat() path.
    if (inv.premiumMeal > 0) {
      entity.set(Inventory, { ...inv, premiumMeal: inv.premiumMeal - 1 })
      feedUse(entity, 'charisma', actionsConfig.premiumMealCharismaFeed, 1)
    } else if (inv.meal > 0) {
      entity.set(Inventory, { ...inv, meal: inv.meal - 1 })
    }
  },
  drinking: (entity) => {
    // Public-tap drink doesn't draw from inventory.
    const rough = entity.get(RoughUse)
    if (rough?.kind === 'tap') return
    const inv = entity.get(Inventory)
    if (inv && inv.water > 0) entity.set(Inventory, { ...inv, water: inv.water - 1 })
  },
}

export function actionSystem(world: World, gameMinutes: number) {
  for (const entity of world.query(Action, IsPlayer)) {
    const a = entity.get(Action)!
    if (a.kind === 'idle' || a.kind === 'walking' || a.kind === 'working') continue
    // Reading is the only player-exclusive feed; the others (reveling,
    // sleeping, walking) feed in systems that iterate the full entity set.
    if (a.kind === 'reading') feedUse(entity, 'intelligence', FEED.reading, gameMinutes)
    if (a.kind === 'exercising') feedUse(entity, 'strength', FEED.gym, gameMinutes)
    a.remaining -= gameMinutes
    if (a.remaining <= 0) {
      const wasKind = a.kind
      const reward = REWARDS[wasKind]
      if (reward) reward(entity)
      if (wasKind === 'sleeping') {
        // Bed lifecycle owned by rent window (rentSystem). Only the rough
        // bench needs explicit release here.
        releaseRoughSpotFor(world, entity)
      }
      if (wasKind === 'reveling') releaseBarSeatFor(world, entity)
      a.kind = 'idle'
      a.remaining = 0
      a.total = 0
      if ((wasKind === 'eating' || wasKind === 'drinking') && canResumeWorkAt(world, entity)) {
        a.kind = 'working'
      }
    }
    entity.set(Action, a)
  }
}

function canResumeWorkAt(world: World, entity: Entity): boolean {
  const j = entity.get(Job)
  const ws = j?.workstation ?? null
  if (!ws) return false
  const wsTrait = ws.get(Workstation)
  if (!wsTrait) return false
  const spec = getJobSpec(wsTrait.specId)
  if (!spec) return false
  const now = useClock.getState().gameDate
  if (!isInWorkWindowWS(now, spec)) return false
  const pos = entity.get(Position)
  if (!pos) return false
  for (const otherWs of world.query(Position, Workstation)) {
    const wp = otherWs.get(Position)!
    if (Math.hypot(pos.x - wp.x, pos.y - wp.y) < worldConfig.ranges.workstationOccupied) return true
  }
  return false
}
