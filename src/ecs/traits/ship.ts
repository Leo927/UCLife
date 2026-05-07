// Ship traits — Phase 6.0+ space layer. Ship-as-scene (interior walkable
// world, ShipRoom + WeaponMount sub-entities) plus the spaceCampaign
// world's Body/POI/Velocity/Thrust/Course/EnemyAI/EnemyShipState.

import { trait } from 'koota'

// Phase 6.0 — ship-as-scene. The ship interior is a normal koota world (its
// own coordinate space, walls/doors, NPC roster). Ship-wide state is held on
// a single Ship singleton spawned at scene-bootstrap time; per-room and
// per-loadout state ride alongside on dedicated entities.

// Whole-ship state. One per ship-scene world. `dockedAtPoiId` empty string
// means "in flight". `fleetPos` is the fleet token's position on the Earth
// Sphere campaign map; snapped to a POI when docked.
//
// Starsector-shape combat stats (armor / fluxMax / fluxCurrent / fluxDissipation /
// shieldEfficiency / topSpeed / maneuverability) live here as a single
// flat block — there's only ever one player flagship in 6.0, and a flat
// shape keeps the save/load layer simple.
export const Ship = trait({
  classId: '',
  hullCurrent: 0, hullMax: 0,
  armorMax: 0, armorCurrent: 0,
  fluxMax: 0, fluxCurrent: 0,
  fluxDissipation: 0,
  // UC default: ships don't carry energy shields (the flux/shield damage
  // path is end-game MS only). Flux still gates weapon power output.
  hasShield: false,
  shieldEfficiency: 1,    // multiplier on flux-per-damage (1 = neutral)
  topSpeed: 0,            // map-units/sec equivalent for tactical movement
  maneuverability: 0,     // 0..1, scales turn rate
  // Combat readiness — Starsector-shape gauge that depletes in combat
  // and restores at safe POIs. Low CR = worse combat performance.
  // Phase 6.0 only mutates CR on flee/defeat outcomes; per-tick CR drain
  // during tactical engagements lands with multi-ship deployment in 6.2.
  crCurrent: 0, crMax: 100,
  fuelCurrent: 0, fuelMax: 0,
  suppliesCurrent: 0, suppliesMax: 0,
  dockedAtPoiId: '',
  fleetPos: { x: 0, y: 0 } as { x: number; y: number },
  inCombat: false,
})

// One per room in the ship class's roomLayout. Pure walkable space — the
// FTL-era oxygen / fire / breach / system fields were dropped in the
// Starsector pivot. Rooms keep their name/visual identity for the
// embodied layer (downtime, mode-switch, story beats); combat damage
// no longer routes through them.
export const ShipRoom = trait({
  roomDefId: '',
})

// One per weapon hardpoint. The weaponId references data/weapons.json5;
// `targetIdx` indexes into the active EnemyShip list during combat
// (-1 = no target, default = nearest hostile). Charge tick is in seconds
// of charge accumulated; `ready` flips true at chargeSec >= weapon.chargeSec.
export const WeaponMount = trait({
  mountIdx: 0,
  weaponId: '',
  size: 'small' as 'small' | 'medium' | 'large',
  chargeSec: 0,
  ready: false,
  targetIdx: -1,
})

// ── Phase 6.0 spaceCampaign traits ────────────────────────────────────
//
// World-pos entities live in the spaceCampaign koota world. Bodies and
// POIs are decorative (their positions are derived per-frame from
// orbits.ts; the Position trait is a cache). Ships have continuous
// physics — Velocity / Thrust / Course drive them via the engine.

export const Body = trait({
  bodyId: '',         // refs celestialBodies.json5
})

export const PoiTag = trait({
  poiId: '',          // refs pois.json5
})

export const ShipBody = trait({
  // Marker that this entity participates in space physics. Distinguishes
  // the player fleet from celestial bodies and POIs in queries.
})

export const Velocity = trait({
  vx: 0,
  vy: 0,
})

export const Thrust = trait({
  // px/sec² acceleration the system applies this frame. Reset to 0 by
  // the integrator after consumption — set by helm input or autopilot.
  ax: 0,
  ay: 0,
})

export const Course = trait({
  // Autopilot target. tx/ty in world px. destPoiId optional — when set,
  // an arrival snaps the ship to that POI's derived position and docks.
  tx: 0,
  ty: 0,
  destPoiId: null as string | null,
  active: false,
})

export const EnemyAI = trait(() => ({
  // Carried by enemy ships in spaceCampaign. Mode + patrol path live
  // here; aggro state is computed each tick from spatial queries.
  shipClassId: '',
  mode: 'patrol' as 'patrol' | 'idle' | 'chase' | 'flee',
  patrolPath: [] as { x: number; y: number }[],
  patrolIdx: 0,
  aggroRadius: 0,
  fleeHullPct: 0,
}))

export const MaintenanceLoad = trait({
  // Total per-tick supply drain contribution from MS units / modules
  // attached to this ship. Slice 7 reads this for supply economy.
  loadUnits: 0,
})

// Starsector-shape enemy ship state during a tactical engagement.
// Continuous-space position + heading, full stat block, hardpoint list.
// Held as plain trait data on a placeholder entity in the player ship's
// world; tactical UI snapshots from this each frame.
export const EnemyShipState = trait(() => ({
  shipClassId: 'pirateLight' as string,
  nameZh: '',
  // Tactical position in map-units (combat arena is sized in arena units,
  // not normalized 0..100 like the campaign map).
  pos: { x: 0, y: 0 } as { x: number; y: number },
  vel: { x: 0, y: 0 } as { x: number; y: number },
  heading: 0,    // radians, 0 = +x
  hullCurrent: 0, hullMax: 0,
  armorCurrent: 0, armorMax: 0,
  fluxMax: 0, fluxCurrent: 0, fluxDissipation: 0,
  hasShield: false,
  shieldEfficiency: 1,
  shieldUp: true,
  topSpeed: 0,
  maneuverability: 0.5,
  weapons: [] as {
    weaponId: string
    size: 'small' | 'medium' | 'large'
    chargeSec: number
    ready: boolean
  }[],
  ai: { aggression: 0.5, retreatThreshold: 0.2 },
}))
