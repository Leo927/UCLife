// Appearance → LPC manifest adapter. Single place where UC's appearance
// vocabulary (FC-style: skin='light', hColor='auburn', etc.) meets the LPC
// catalog. Unknown values fall back to a documented default rather than
// throwing — character rendering is decorative.

import type { AppearanceData } from '../../character/appearanceGen'
import type {
  LpcBodyPalette,
  LpcBodyType,
  LpcHairPalette,
  LpcLayer,
  LpcManifest,
} from './types'

function pickBodyType(a: AppearanceData): LpcBodyType {
  if (a.gender === 'female') return 'female'
  // Threshold matches FC's +30 muscular cutoff.
  return a.muscles > 30 ? 'muscular' : 'male'
}

const SKIN_TO_LPC: Record<string, LpcBodyPalette> = {
  pale: 'light',
  fair: 'light',
  light: 'light',
  tanned: 'amber',
  olive: 'olive',
  dark: 'brown',
}

function pickBodyPalette(skin: string): LpcBodyPalette {
  return SKIN_TO_LPC[skin] ?? 'light'
}

const HAIR_COLOR_TO_LPC: Record<string, LpcHairPalette> = {
  black: 'black',
  'dark brown': 'dark_brown',
  brown: 'light_brown',
  chestnut: 'chestnut',
  auburn: 'redhead',
  red: 'red',
  blonde: 'blonde',
  'platinum blonde': 'platinum',
}

function pickHairPalette(hColor: string): LpcHairPalette {
  return HAIR_COLOR_TO_LPC[hColor] ?? 'light_brown'
}

// Long/braided LPC sheets upstream split into fg (drawn above body, zPos 120)
// + bg (drawn behind body at zPos 9, < body's 10) so hair drapes behind the
// back. See sheet_definitions/hair/*.json layer_1/layer_2.
type HairResolved =
  | { skip: true }
  | { flat: string }
  | { fg: string; bg: string }

function flat(basePath: string): HairResolved { return { flat: basePath } }
function split(folder: string): HairResolved {
  return { fg: `${folder}/fg`, bg: `${folder}/bg` }
}

function pickHairSheet(a: AppearanceData): HairResolved {
  const { gender, hStyle, hLength } = a

  if (gender === 'male') {
    switch (hStyle) {
      case 'shaved':
        return { skip: true }
      case 'crew cut':
        return flat('hair/buzzcut/adult')
      case 'short':
        return flat('hair/plain/adult')
      case 'neat':
        return flat('hair/parted/adult')
      case 'messy':
        return flat('hair/messy1/adult')
      default:
        return flat('hair/plain/adult')
    }
  }

  // female
  switch (hStyle) {
    case 'pixie':
      return flat('hair/pixie/adult')
    case 'short':
      return flat('hair/plain/adult')
    case 'shoulder-length':
      return flat('hair/bob/adult')
    case 'neat':
      // 40cm ≈ shoulder length; long sheets above it, bob below.
      return hLength >= 40
        ? split('hair/long_center_part/adult')
        : flat('hair/parted/adult')
    case 'messy bun':
      return flat('hair/bedhead/adult')
    case 'braided':
      return split('hair/braid/adult')
    case 'tails':
      return hLength >= 40
        ? flat('hair/pigtails/adult')
        : split('hair/bunches/adult')
    default:
      return flat('hair/plain/adult')
  }
}

// LPC body sheets are bare (no facial features) — the head is a separate
// modular layer that must be composed in or characters look faceless. FC's
// match_body_color: true → use the same skin palette so head and body align
// tonally.
function pickHeadFolder(bodyType: LpcBodyType): string {
  if (bodyType === 'female' || bodyType === 'pregnant') return 'head/heads/human/female'
  return 'head/heads/human/male'
}

export function appearanceToLpc(a: AppearanceData): LpcManifest {
  const bodyType = pickBodyType(a)
  const skin = pickBodyPalette(a.skin)
  const layers: LpcLayer[] = []

  layers.push({
    basePath: `body/bodies/${bodyType}`,
    material: 'body',
    color: skin,
    zPos: 10,
  })

  layers.push({
    basePath: pickHeadFolder(bodyType),
    material: 'body',
    color: skin,
    zPos: 100,
  })

  const hair = pickHairSheet(a)
  if (!('skip' in hair)) {
    const color = pickHairPalette(a.hColor)
    if ('flat' in hair) {
      layers.push({ basePath: hair.flat, material: 'hair', color, zPos: 120 })
    } else {
      layers.push({ basePath: hair.fg, material: 'hair', color, zPos: 120 })
      layers.push({ basePath: hair.bg, material: 'hair', color, zPos: 9 })
    }
  }

  return { bodyType, layers }
}
