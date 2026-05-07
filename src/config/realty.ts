import json5 from 'json5'
import raw from './realty.json5?raw'

export type ListingCategory = 'residential' | 'commercial' | 'factionMisc' | 'civic' | 'hidden'

export interface RealtyTypeSpec {
  category: ListingCategory
  buyable: boolean
  lease?: boolean
  buildingPriceTilesMul?: number
  labelZh?: string
}

export interface RealtyConfig {
  types: Record<string, RealtyTypeSpec>
  listingMul: { state: number; private: number }
  talkSale: {
    priceBand: { min: number; max: number }
    factionRepWeight: number
  }
}

export const realtyConfig = json5.parse(raw) as RealtyConfig

export function getRealtyType(typeId: string): RealtyTypeSpec | null {
  return realtyConfig.types[typeId] ?? null
}
