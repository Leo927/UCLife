// Public ECS→render contract for the ground (top-down map) renderer.

import type { Entity } from 'koota'
import type {
  InteractableKind, RoadKind, BedTier, ActionKind,
} from '../ecs/traits'
import type { AppearanceData } from '../character/appearanceGen'
import type { LpcDirection } from './sprite/types'

export interface RoadSnap {
  ent: Entity
  x: number; y: number; w: number; h: number
  kind: RoadKind
}

export interface BuildingSnap {
  ent: Entity
  x: number; y: number; w: number; h: number
  label: string
}

export interface WallSnap {
  ent: Entity
  x: number; y: number; w: number; h: number
}

export interface DoorSnap {
  ent: Entity
  x: number; y: number; w: number; h: number
  factionGated: boolean
  bedKeyed: boolean
}

export interface BedSnap {
  ent: Entity
  x: number; y: number
  tier: BedTier
  occupied: boolean
  isPlayerBed: boolean
  ownedByPlayer: boolean
  fee: number
  label: string
  multiplier: number
}

export interface BarSeatSnap {
  ent: Entity
  x: number; y: number
  occupied: boolean
  fee: number
}

export interface InteractableSnap {
  ent: Entity
  x: number; y: number
  kind: InteractableKind
  label: string
  fee: number
  benchOccupied: boolean
}

export interface NpcSnap {
  ent: Entity
  x: number; y: number
  appearance: AppearanceData
  name: string
  staticTitle: string
  workTitle: string | null
  actionKind: ActionKind
  /** Computed walking direction from move target; null = preserve last facing. */
  facingHint: LpcDirection | null
  vitalsProgress: number  // -1 if no progress bar
  speech: string | null
  isDead: boolean
  // Phase 4.2 — true when the NPC carries a symptomatic instance of an
  // infectious condition template (flu rising/peak/recovering/stalled).
  // Drives the cough/sneeze emote glyph in the worldspace renderer.
  symptomaticInfectious: boolean
}

export interface PlayerSnap {
  ent: Entity
  x: number; y: number
  appearance: AppearanceData
  actionKind: ActionKind
  facingHint: LpcDirection | null
  ringStroke: number
  ringWidth: number
  ringOpacity: number
}

export interface GroundSnapshot {
  // Camera frame.
  camX: number
  camY: number
  canvasW: number
  canvasH: number
  // World envelope (for background).
  worldW: number
  worldH: number
  // Tile size (for grid lines).
  tilePx: number
  // Visible entities — pre-culled by the caller.
  roads: RoadSnap[]
  buildings: BuildingSnap[]
  walls: WallSnap[]
  doors: DoorSnap[]
  beds: BedSnap[]
  barSeats: BarSeatSnap[]
  interactables: InteractableSnap[]
  npcs: NpcSnap[]
  player: PlayerSnap | null
  // Move-target indicator.
  moveTarget: { x: number; y: number } | null
  // Animation tick (12Hz from animTick.ts).
  animTick: number
  // Current game-time in ms. Used by the sneeze-emote pulse timer so
  // glyph cadence tracks sim time (not wall-clock RAF cadence) and
  // pauses cleanly when the player pauses the game.
  gameMs: number
  // Click dispatchers — invoked by Pixi pointer events on hit nodes.
  onNpcClick: (ent: Entity) => void
  onInteractableClick: (ent: Entity, x: number, y: number) => void
}
