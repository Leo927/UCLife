// Map a Koota Character entity to the SlaveLike shape FC's portrait
// renderer expects. Visual decisions live in the Appearance trait; this
// adapter translates field names and clamps explicit-content fields that
// don't apply to UC's civilian setting.

import type { Entity } from 'koota'
import { Appearance, Character } from '../../../ecs/traits'
import { hashSeed } from '../../../character/appearanceGen'
import type { SlaveLike } from './SlaveLike'
import { makeBaseSlave } from './defaults'

let warnedMissingAppearance = false

export function characterToSlave(entity: Entity): SlaveLike {
  const ch = entity.get(Character)
  const ap = entity.get(Appearance)
  const name = ch?.name ?? `npc-${entity.id()}`

  if (!ap) {
    if (!warnedMissingAppearance) {
      console.warn(`characterToSlave: ${name} has no Appearance trait — using baseline. Check spawn path.`)
      warnedMissingAppearance = true
    }
    return makeBaseSlave({ name })
  }

  // FC's RevampedArtControl uses slave.ID as a per-body RNG seed (asymmetric
  // jitter etc.). Stable across reloads.
  const id = (hashSeed(name) % 0x7fffffff) || 1
  const slave = makeBaseSlave({
    id,
    name,
    preset: ap.gender === 'male' ? 'civilian-male' : 'civilian-female',
  })

  slave.physicalAge = ap.physicalAge
  slave.skin = ap.skin
  slave.hStyle = ap.hStyle
  slave.hLength = ap.hLength
  slave.hColor = ap.hColor
  slave.pubicHStyle = ap.pubicHStyle
  slave.pubicHColor = ap.pubicHColor
  slave.underArmHStyle = ap.underArmHStyle
  slave.underArmHColor = ap.underArmHColor
  slave.eye.left.iris = ap.eyeIris
  slave.eye.right.iris = ap.eyeIris

  slave.weight = ap.weight
  slave.muscles = ap.muscles
  slave.height = ap.height
  slave.hips = ap.hips
  slave.butt = ap.butt
  slave.waist = ap.waist
  slave.boobs = ap.boobs
  slave.lips = ap.lips
  slave.makeup = ap.makeup

  // Content guardrail: UC NPCs are nude civilians for now (clothing system
  // is a future feature). Clamp anything that would produce overtly
  // sexualized visuals — chastity gear, fuckdoll suits, pregnancy belly —
  // regardless of trait state.
  slave.clothes = 'no clothing'
  slave.shoes = 'none'
  slave.chastityVagina = false
  slave.chastityPenis = false
  slave.chastityAnus = false
  slave.fuckdoll = 0
  slave.preg = 0
  slave.belly = 0

  return slave
}
