import json5 from 'json5'
import raw from './population.json5?raw'

export interface PopulationConfig {
  target: number
  replenishIntervalMin: number
}

export const populationConfig = json5.parse(raw) as PopulationConfig
