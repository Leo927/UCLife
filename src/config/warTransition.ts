import json5 from 'json5'
import raw from './warTransition.json5?raw'

export interface WarFrontSpec {
  // Stable front id, referenced by war-events.json5 frontShift keys.
  id: string
  nameZh: string
  // Initial Federation-vs-Zeon control seed (0–100).
  control: number
}

export interface WarTransitionConfig {
  // UC date the war flips on, format "UC YYYY.MM.DD".
  triggerDateKey: string
  // Seed strengths copied onto warState when the gate flips. Keyed by
  // faction id ('federation' | 'zeon' | 'anaheim' …).
  initialFactionStrength: Record<string, number>
  fronts: WarFrontSpec[]
}

export const warTransitionConfig = json5.parse(raw) as WarTransitionConfig
