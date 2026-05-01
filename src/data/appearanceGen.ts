import type { Gender } from '../ecs/traits'

export interface AppearanceData {
  gender: Gender
  physicalAge: number
  skin: string
  hStyle: string
  hLength: number
  hColor: string
  pubicHStyle: string
  pubicHColor: string
  underArmHStyle: string
  underArmHColor: string
  eyeIris: string
  weight: number
  muscles: number
  height: number
  hips: number
  butt: number
  waist: number
  boobs: number
  lips: number
  makeup: number
}

// FNV-1a 32-bit. Same name → same seed across reloads + saves.
export function hashSeed(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

// mulberry32. Same PRNG family FC uses, so portrait output stays comparable.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const HAIR_COLORS = ['black', 'brown', 'auburn', 'chestnut', 'blonde', 'dark brown', 'red', 'platinum blonde']
const SKIN_TONES = ['fair', 'light', 'tanned', 'dark', 'olive', 'pale']
const EYE_IRISES = ['brown', 'hazel', 'amber', 'blue', 'green', 'grey']
const HAIR_STYLES_FEMALE = ['neat', 'messy bun', 'tails', 'shoulder-length', 'short', 'pixie', 'braided']
const HAIR_STYLES_MALE = ['short', 'neat', 'messy', 'shaved', 'crew cut']

interface GenOpts {
  gender?: Gender
}

export function generateAppearance(seed: number, opts: GenOpts = {}): AppearanceData {
  const rng = mulberry32(seed)
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)]
  const range = (lo: number, hi: number): number => lo + Math.floor(rng() * (hi - lo + 1))
  // Triangular distribution — bell-shaped, clusters at midpoint.
  const tri = (lo: number, hi: number): number =>
    lo + Math.floor(((rng() + rng()) / 2) * (hi - lo + 1))

  const gender: Gender = opts.gender ?? (rng() < 0.5 ? 'male' : 'female')

  // Color shared with pubic + underarm by default — per-NPC overrides take
  // those separately when needed.
  const hColor = pick(HAIR_COLORS)
  const hStyle = gender === 'male' ? pick(HAIR_STYLES_MALE) : pick(HAIR_STYLES_FEMALE)
  const hLength = gender === 'male' ? range(2, 25) : range(10, 100)

  const skin = pick(SKIN_TONES)
  const eyeIris = pick(EYE_IRISES)

  // Triangular weight/muscles cluster civilian-normal with a tail covering
  // lean/heavy/athletic outliers. FC renderer maps onto its size brackets.
  const height = gender === 'male' ? range(165, 188) : range(152, 175)
  const weight = tri(-40, 70)
  const muscles = gender === 'male' ? tri(-20, 60) : tri(-30, 40)
  const hips = gender === 'male' ? range(-1, 1) : range(0, 2)
  const butt = range(1, 4)
  const waist = gender === 'male' ? range(-5, 15) : range(-15, 10)
  const boobs = gender === 'male' ? 0 : range(800, 2000)
  const lips = range(15, 40)

  const physicalAge = range(20, 55)

  const makeupRoll = rng()
  const makeup = gender === 'male'
    ? 0
    : (makeupRoll < 0.55 ? 0 : makeupRoll < 0.85 ? 1 : 2)

  return {
    gender,
    physicalAge,
    skin,
    hStyle,
    hLength,
    hColor,
    pubicHStyle: 'neat',
    pubicHColor: hColor,
    underArmHStyle: 'shaved',
    underArmHColor: hColor,
    eyeIris,
    weight,
    muscles,
    height,
    hips,
    butt,
    waist,
    boobs,
    lips,
    makeup,
  }
}

export function generateAppearanceForName(name: string, opts: GenOpts = {}): AppearanceData {
  return generateAppearance(hashSeed(name), opts)
}
