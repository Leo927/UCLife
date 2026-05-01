// Subset of FC's HumanState — just the fields the revamp renderer + its
// helpers actually access. FC's HumanState has 200+ fields; we add as needed.

export interface Eye {
  type: number      // FC convention: 1 = natural, 2 = glass, 3 = cyber, …
  iris: string      // hair-color-style string ("blue", "amber", hex, …)
  pupil: string     // "circular" | "demonic" | "devilish" | "vertical" | …
  sclera: string
  vision: number    // 1 = sighted, 0 = blind
}

export interface Limb {
  type: number      // 1 = natural; 2+ = various prosthetics
}

export interface Piercing {
  weight: number    // 0 = none, 1 = light, 2 = heavy
  /** Smart piercings only — undefined elsewhere. */
  smart?: boolean
}

export interface SlaveLike {
  /** Stable numeric id used as a per-slave RNG seed. */
  ID: number
  physicalAge: number
  pubertyAgeXX: number
  pubertyAgeXY: number
  weight: number    // -100..+100
  muscles: number   // -100..+100
  height: number    // cm
  hips: number      // -2..3
  butt: number      // 0..10
  waist: number     // -100..+100
  boobs: number     // cc
  areolae: number   // 0..4
  areolaeShape: string
  lips: number      // 0..100
  skin: string      // "fair", "pale", "light", "dark", "black", "tanned", …
  hStyle: string
  hLength: number   // 0 (bald) .. 150
  hColor: string
  pubicHStyle: string
  pubicHColor: string
  underArmHStyle: string
  underArmHColor: string
  vagina: number    // -1 = absent, 0 = virgin, 1+ = stretched
  dick: number      // 0 = absent, 1+ sizes
  scrotum: number
  balls: number
  clitSetting: string
  devotion: number  // -100..+100
  trust: number     // -100..+100
  fuckdoll: number  // 0 = none, 1+ = fuckdoll suit
  preg: number      // -3 .. 40+ weeks
  belly: number     // cc (preg + implants + food combined)
  clothes: string
  shoes: string
  collar: string
  eyewear: string
  earwear: string
  mouthAccessory: string
  bellyAccessory: string
  legAccessory: string
  vaginaTat: string
  makeup: number    // 0..8
  chastityVagina: boolean
  chastityPenis: boolean
  chastityAnus: boolean
  // Singular keys per FC convention.
  eye: { left: Eye; right: Eye }
  arm: { left: Limb; right: Limb }
  leg: { left: Limb; right: Limb }
  piercing: {
    nipple: Piercing
    areola: Piercing
    navel: Piercing
    nose: Piercing
    eyebrow: Piercing
    lips: Piercing
    ear: Piercing
    dick: Piercing
    vagina: Piercing
    genitals: Piercing
  }
  [extraField: string]: unknown
}
