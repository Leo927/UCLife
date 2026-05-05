import type { AppearanceData } from '../../character/appearanceGen'
import { appearanceToLpc } from './appearanceToLpc'
import { composeSheet } from './compose'
import type { LpcAnimation, LpcManifest } from './types'

export type { LpcAnimation, LpcManifest, LpcDirection } from './types'
export { appearanceToLpc } from './appearanceToLpc'
export {
  composeSheet,
  FRAME_SIZE,
  FRAMES_PER_ROW,
  SHEET_WIDTH,
  SHEET_HEIGHT,
  clearSheetCache,
  spriteStats,
  resetSpriteStats,
  getSpriteCacheSize,
} from './compose'

const DIRECTION_ROW = { up: 0, left: 1, down: 2, right: 3 } as const

export function directionRowY(d: keyof typeof DIRECTION_ROW): number {
  return DIRECTION_ROW[d] * 64
}

export function getCharacterSprite(a: AppearanceData, animation: LpcAnimation): Promise<HTMLCanvasElement> {
  const manifest = appearanceToLpc(a)
  return composeSheet(manifest, animation)
}

export function describeCharacter(a: AppearanceData): LpcManifest {
  return appearanceToLpc(a)
}
