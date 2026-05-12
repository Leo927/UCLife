import json5 from 'json5'
import raw from './art.json5?raw'

export interface ArtAssetSpec {
  /** Path under Vite's public root, e.g. `/art/objects/bed-flop.png`. */
  path: string
}

export type ArtId = string

export interface ArtConfig {
  catalog: Record<ArtId, ArtAssetSpec>
}

export const artConfig: ArtConfig = json5.parse(raw)
