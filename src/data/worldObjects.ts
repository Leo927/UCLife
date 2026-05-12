import json5 from 'json5'
import raw from './world-objects.json5?raw'
import type { BedTier, InteractableKind } from '../config/kinds'
import type { ArtId } from '../config/art'

export interface ObjectVisual {
  /** Procedural-fallback palette. Required even when `assetId` is set so beds keep their colored fee/owner overlays. */
  fill: number
  stroke: number
  /** Optional sprite. When set the renderer paints the asset at (w × h); otherwise draws procedurally. */
  assetId?: ArtId
}

export interface SizedObjectVisual extends ObjectVisual {
  /** Drawn footprint in world pixels — the rectangle the renderer paints into. */
  w: number
  h: number
}

export interface LabeledObjectVisual extends SizedObjectVisual {
  /** zh-CN display string used by the renderer (and by snapshot label fallback). */
  label: string
}

export type DoorVariant = 'open' | 'factionGated' | 'bedKeyed'

export interface WorldObjects {
  beds: Record<BedTier, LabeledObjectVisual>
  interactables: Record<InteractableKind, SizedObjectVisual>
  doors: Record<DoorVariant, ObjectVisual>
  walls: { default: ObjectVisual }
  barSeats: { default: SizedObjectVisual }
  buildings: { default: ObjectVisual }
}

export const worldObjects: WorldObjects = json5.parse(raw)
