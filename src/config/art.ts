import json5 from 'json5'
import raw from './art.json5?raw'
import type { BedTier } from './kinds'

export interface BedAssetSpec {
  assetPath: string
  w: number
  h: number
}

export interface ArtConfig {
  bedAssets: Partial<Record<BedTier, BedAssetSpec>>
}

export const artConfig: ArtConfig = json5.parse(raw)
