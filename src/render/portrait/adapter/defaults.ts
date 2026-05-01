// Hand-crafted from FC's HumanState defaults (src/js/states/002-HumanState.js)
// plus the fields the revamp renderer reads.

import type { SlaveLike, Eye, Limb, Piercing } from './SlaveLike'

const naturalEye = (iris = 'brown'): Eye => ({
  type: 1,
  iris,
  pupil: 'circular',
  sclera: 'white',
  vision: 1,
})

const naturalLimb = (): Limb => ({ type: 1 })

const noPiercing = (): Piercing => ({ weight: 0 })

let nextSlaveId = 1
function allocSlaveId(): number {
  return nextSlaveId++
}

export interface MakeSlaveOpts {
  id?: number
  name?: string
  preset?: 'civilian-female' | 'civilian-male'
}

export function makeBaseSlave(opts: MakeSlaveOpts = {}): SlaveLike {
  const id = opts.id ?? allocSlaveId()
  const isMale = opts.preset === 'civilian-male'
  const slave: SlaveLike = {
    ID: id,
    physicalAge: 25,
    pubertyAgeXX: 13,
    pubertyAgeXY: 14,
    weight: 0,
    muscles: 0,
    height: isMale ? 178 : 165,
    hips: 0,
    butt: 2,
    waist: 0,
    boobs: isMale ? 0 : 350,
    areolae: 1,
    areolaeShape: 'circle',
    lips: 25,
    skin: 'light',
    hStyle: 'neat',
    hLength: 30,
    hColor: 'brown',
    pubicHStyle: 'neat',
    pubicHColor: 'brown',
    underArmHStyle: 'shaved',
    underArmHColor: 'brown',
    vagina: isMale ? -1 : 0,
    dick: isMale ? 3 : 0,
    scrotum: isMale ? 3 : 0,
    balls: isMale ? 3 : 0,
    clitSetting: 'vanilla',
    devotion: 50,
    trust: 50,
    fuckdoll: 0,
    preg: 0,
    belly: 0,
    clothes: 'no clothing',
    shoes: 'none',
    collar: 'none',
    eyewear: 'none',
    earwear: 'none',
    mouthAccessory: 'none',
    bellyAccessory: 'none',
    legAccessory: 'none',
    vaginaTat: '',
    makeup: 0,
    chastityVagina: false,
    chastityPenis: false,
    chastityAnus: false,
    eye: { left: naturalEye('brown'), right: naturalEye('brown') },
    arm: { left: naturalLimb(), right: naturalLimb() },
    leg: { left: naturalLimb(), right: naturalLimb() },
    piercing: {
      nipple: noPiercing(),
      areola: noPiercing(),
      navel: noPiercing(),
      nose: noPiercing(),
      eyebrow: noPiercing(),
      lips: noPiercing(),
      ear: noPiercing(),
      dick: noPiercing(),
      vagina: noPiercing(),
      genitals: { weight: 0, smart: false },
    },
  }
  return slave
}
