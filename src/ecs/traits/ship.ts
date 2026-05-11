// Ship traits — Phase 6.0+ space layer. Ship-as-scene (interior walkable
// world, ShipRoom + WeaponMount sub-entities) plus the spaceCampaign
// world's Body/POI/Velocity/Thrust/Course/EnemyAI/CombatShipState.

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
// shieldEfficiency / topSpeed / accel / decel / angularAccel / maxAngVel) live
// here as a single flat block — there's only ever one player flagship in 6.0,
// and a flat shape keeps the save/load layer simple.
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
  topSpeed: 0,            // hard cap on |velocity| in arena units/sec
  accel: 0,               // linear thrust accel (units/sec²) when input is held
  decel: 0,               // passive linear braking (units/sec²) when no input
  angularAccel: 0,        // steering torque (rad/sec²)
  maxAngVel: 0,           // angular velocity ceiling (rad/sec)
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
//
// `firingArcRad` is the total firing arc width (radians) — combat checks
// whether the target is within ±firingArcRad/2 of the mount centerline.
// `facingRad` is the mount centerline direction relative to ship heading
// (0 = forward, +π/2 = starboard). Each turret can declare its own arc
// independently of other mounts on the same ship.
export const WeaponMount = trait({
  mountIdx: 0,
  weaponId: '',
  size: 'small' as 'small' | 'medium' | 'large',
  firingArcRad: Math.PI,
  facingRad: 0,
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
  // the autopilot retargets to the POI's live derived position each
  // frame (orbits move). autoDock = "park at this POI on arrival" (dock
  // intent from the starmap context menu); otherwise the ship just
  // halts in space at the destination.
  tx: 0,
  ty: 0,
  destPoiId: null as string | null,
  active: false,
  autoDock: false,
})

export const EnemyAI = trait(() => ({
  // Carried by enemy ships in spaceCampaign. Mode + patrol path live
  // here; aggro state is computed each tick from spatial queries.
  shipClassId: '',
  // Escort ship class IDs deployed alongside this lead ship when the
  // engagement triggers. Empty = solo. Each escort spawns its own
  // CombatShipState in the tactical arena.
  escorts: [] as string[],
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

// Starsector-shape combat-time ship state during a tactical engagement.
// Continuous-space position + heading + velocity + angular velocity, full
// stat block, hardpoint list, and an AI directive block. Player flagship,
// every enemy, and (Phase 6.1+) every player-launched MS carry this trait
// during combat. The physics + AI loop is unified: every unit runs the
// same maintainRange-style AI; player input overrides thrust + aim on
// whichever unit `pilotedByPlayer` is currently true on.
//
// Discriminators:
//   side='player' — friendly to player (flagship + launched MS)
//   side='enemy'  — hostile (procedural enemies)
//   isFlagship    — the persistent Ship singleton (hull lives on Ship,
//                   not on this trait); CombatShipState's hull / armor /
//                   weapons fields stay zero/empty for the flagship and
//                   damage routes through sim/ship.ts:damageHull. Equal
//                   to the legacy `isPlayer` discriminator on the
//                   flagship row.
//   isMs          — Phase 6.1 player-side mobile suit. Hull/armor/weapons
//                   fields ARE used; damage routes to this trait directly.
//   pilotedByPlayer — at most one unit at a time; combatSystem reads
//                   the WASD axis + shift+mouse aim onto this unit and
//                   leaves all others on AI.
export const CombatShipState = trait(() => ({
  shipClassId: 'pirateLight' as string,
  nameZh: '',
  side: 'enemy' as 'player' | 'enemy',
  isFlagship: false,
  isMs: false,
  pilotedByPlayer: false,
  // Legacy field — true on the flagship row, false everywhere else.
  // Existing callers query `cs.isPlayer` to mean "this is the persistent
  // Ship singleton entity"; new code prefers `isFlagship`.
  isPlayer: false,
  // Tactical position in map-units (combat arena is sized in arena units,
  // not normalized 0..100 like the campaign map).
  pos: { x: 0, y: 0 } as { x: number; y: number },
  vel: { x: 0, y: 0 } as { x: number; y: number },
  heading: 0,    // radians, 0 = +x
  angVel: 0,     // radians/sec
  hullCurrent: 0, hullMax: 0,
  armorCurrent: 0, armorMax: 0,
  fluxMax: 0, fluxCurrent: 0, fluxDissipation: 0,
  hasShield: false,
  shieldEfficiency: 1,
  shieldUp: true,
  topSpeed: 0,
  accel: 0,
  decel: 0,
  angularAccel: 0,
  maxAngVel: 0,
  weapons: [] as {
    weaponId: string
    size: 'small' | 'medium' | 'large'
    firingArcRad: number
    facingRad: number
    chargeSec: number
    ready: boolean
  }[],
  ai: { aggression: 0.5, retreatThreshold: 0.2, maintainRange: 160 },
}))
