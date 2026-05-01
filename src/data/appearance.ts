import json5 from 'json5'
import raw from './npc-appearance.json5?raw'
import type { AppearanceData } from './appearanceGen'

export type AppearanceOverride = Partial<AppearanceData>

const parsed = json5.parse(raw) as Record<string, AppearanceOverride>

export function getAppearanceOverride(name: string): AppearanceOverride | null {
  return parsed[name] ?? null
}

export const appearanceOverrides: Readonly<Record<string, AppearanceOverride>> = Object.freeze(parsed)
