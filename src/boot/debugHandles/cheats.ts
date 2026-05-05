// Player-stat + flag mutators. Strictly for test setup — they bypass
// the in-game economy and skill-progression rules. Production code
// must never reach for these.

import { registerDebugHandle } from '../../debug/uclifeHandle'
import { world } from '../../ecs/world'
import {
  IsPlayer, Attributes, Skills, Money, Reputation, Flags,
} from '../../ecs/traits'
import type { FactionId } from '../../data/factions'
import type { SkillId } from '../../data/skills'

// Path forms:
//   'attributes.<key>'        — sets Attributes[key].value
//   'attributes.<key>.value'  — same as above (explicit)
//   'skills.<key>'            — sets Skills[key]
//   'money'                   — sets Money.amount
//   'reputation.<faction>'    — sets Reputation.rep[faction]
registerDebugHandle('setPlayerStat', (path: string, value: number) => {
  const player = world.queryFirst(IsPlayer)
  if (!player) return false
  const segs = path.split('.')
  if (segs[0] === 'attributes' && segs.length >= 2) {
    const key = segs[1]
    const a = player.get(Attributes)
    if (!a) return false
    const stat = a[key as 'strength']
    if (!stat) return false
    stat.value = value
    player.set(Attributes, a)
    return true
  }
  if (segs[0] === 'skills' && segs.length === 2) {
    const s = player.get(Skills)
    if (!s) return false
    ;(s as unknown as Record<SkillId, number>)[segs[1] as SkillId] = value
    player.set(Skills, s)
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

registerDebugHandle('cheatMoney', (n: number) => {
  const p = world.queryFirst(IsPlayer)
  if (!p) return false
  p.set(Money, { amount: n })
  return true
})

registerDebugHandle('cheatPiloting', (n: number) => {
  const p = world.queryFirst(IsPlayer)
  if (!p) return false
  const s = p.get(Skills)
  if (!s) return false
  ;(s as unknown as Record<SkillId, number>).piloting = n
  p.set(Skills, s)
  return true
})

registerDebugHandle('setShipOwned', () => {
  const p = world.queryFirst(IsPlayer)
  if (!p) return false
  const f = p.get(Flags) ?? { flags: {} }
  p.set(Flags, { flags: { ...f.flags, shipOwned: true } })
  return true
})
