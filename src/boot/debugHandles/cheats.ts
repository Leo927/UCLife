// Player-stat + flag mutators. Strictly for test setup — they bypass
// the in-game economy and skill-progression rules. Production code
// must never reach for these.

import { registerDebugHandle } from '../../debug/uclifeHandle'
import { world } from '../../ecs/world'
import {
  IsPlayer, Attributes, Money, Reputation, Flags,
  type StatId,
} from '../../ecs/traits'
import { setBase, getStat } from '../../stats/sheet'
import { STAT_IDS } from '../../stats/schema'
import { applyBackground, removeBackground } from '../../character/backgrounds'
import type { FactionId } from '../../data/factions'
import { setSkillXp, type SkillId } from '../../character/skills'

const STAT_ID_SET = new Set<string>(STAT_IDS)

// Path forms:
//   'attributes.<key>'        — sets the base value of the named stat
//                                (any StatId — attributes, vital max,
//                                vital drain mul, hpMax, hpRegenMul,
//                                <skill>, <skill>XpMul, wage/shop/rentMul).
//                                Modifiers untouched.
//   'skills.<key>'            — sets the skill XP base on the sheet
//   'money'                   — sets Money.amount
//   'reputation.<faction>'    — sets Reputation.rep[faction]
registerDebugHandle('setPlayerStat', (path: string, value: number) => {
  const player = world.queryFirst(IsPlayer)
  if (!player) return false
  const segs = path.split('.')
  if (segs[0] === 'attributes' && segs.length >= 2) {
    const key = segs[1]
    if (!STAT_ID_SET.has(key)) return false
    const a = player.get(Attributes)
    if (!a) return false
    player.set(Attributes, { ...a, sheet: setBase(a.sheet, key as StatId, value) })
    return true
  }
  if (segs[0] === 'skills' && segs.length === 2) {
    setSkillXp(player, segs[1] as SkillId, value)
    return true
  }
  if (segs[0] === 'money' && segs.length === 1) {
    player.set(Money, { amount: value })
    return true
  }
  if (segs[0] === 'reputation' && segs.length === 2) {
    const r = player.get(Reputation)
    const next = r ? { ...r.rep } : {}
    next[segs[1] as FactionId] = value
    if (r) player.set(Reputation, { rep: next })
    else player.add(Reputation({ rep: next }))
    return true
  }
  return false
})

// Read the player's faction reputation. Used by smoke tests that need
// to assert on rep ledger changes (e.g. AE clinic visit).
registerDebugHandle('getPlayerReputation', (factionId: string) => {
  const p = world.queryFirst(IsPlayer)
  if (!p) return null
  const r = p.get(Reputation)
  if (!r) return 0
  return r.rep[factionId as FactionId] ?? 0
})

registerDebugHandle('cheatMoney', (n: number) => {
  const p = world.queryFirst(IsPlayer)
  if (!p) return false
  p.set(Money, { amount: n })
  return true
})

registerDebugHandle('cheatPiloting', (n: number) => {
  const p = world.queryFirst(IsPlayer)
  if (!p) return false
  setSkillXp(p, 'piloting', n)
  return true
})

registerDebugHandle('setShipOwned', () => {
  const p = world.queryFirst(IsPlayer)
  if (!p) return false
  const f = p.get(Flags) ?? { flags: {} }
  p.set(Flags, { flags: { ...f.flags, shipOwned: true } })
  return true
})

registerDebugHandle('applyBackground', (id: string) => {
  const p = world.queryFirst(IsPlayer)
  if (!p) return false
  return applyBackground(p, id)
})

registerDebugHandle('removeBackground', (id: string) => {
  const p = world.queryFirst(IsPlayer)
  if (!p) return false
  return removeBackground(p, id)
})

// Reads the effective (post-modifier) value of a stat — useful for
// smoke tests that need to assert the modifier system is actually
// folding in background / perk effects.
registerDebugHandle('getPlayerStat', (id: string) => {
  const p = world.queryFirst(IsPlayer)
  if (!p) return null
  if (!STAT_ID_SET.has(id)) return null
  const a = p.get(Attributes)
  if (!a) return null
  return getStat(a.sheet, id as StatId)
})
