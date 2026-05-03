import { trait, relation } from 'koota'
import type { Entity } from 'koota'
import type { FactionId } from '../data/factions'

export const Position = trait({ x: 0, y: 0 })
export const MoveTarget = trait({ x: 0, y: 0 })

// `targetX/Y` is the MoveTarget the path was computed for; movement compares
// it against the current MoveTarget to detect invalidation.
export const Path = trait(() => ({
  waypoints: [] as { x: number; y: number }[],
  index: 0,
  targetX: 0,
  targetY: 0,
}))

export const Wall = trait({ x: 0, y: 0, w: 0, h: 0 })

// Procgen road surface — purely visual + semantic; the pathfinder treats
// it the same as any non-wall space. Drawn in the ground layer below
// buildings so a building's wall reads as flush against the road.
export type RoadKind = 'avenue' | 'street' | 'alley'
export const Road = trait({
  x: 0, y: 0, w: 0, h: 0,
  kind: 'avenue' as RoadKind,
})

// Two independent lock predicates: `bedEntity` keys cell doors to a specific
// bed's active renter; `factionGate` keys faction-internal doors. Both null
// = always open. Both set = locked unless the requester satisfies *either*.
export const Door = trait({
  x: 0, y: 0, w: 0, h: 0,
  orient: 'h' as 'h' | 'v',
  bedEntity: null as Entity | null,
  factionGate: null as FactionId | null,
})

export const Vitals = trait({
  hunger: 0,
  thirst: 0,
  fatigue: 0,
  hygiene: 0,
  // 0 = freshly entertained, 100 = stir-crazy. Display label: 烦闷.
  boredom: 0,
})

// `talent` (0.7–1.4) is the hidden cap multiplier; `recentUse` and
// `recentStress` are 7-day rolling buffers the daily drift system reads.
export type StatState = {
  value: number
  talent: number
  recentUse: number
  recentStress: number
}

const newStat = (): StatState => ({
  value: 50, talent: 1.0, recentUse: 50, recentStress: 0,
})

export const Attributes = trait(() => ({
  strength: newStat(),
  endurance: newStat(),
  charisma: newStat(),
  intelligence: newStat(),
  reflex: newStat(),
  resolve: newStat(),
  // Used to apply drift exactly once per game-day and to skip newly-spawned
  // characters until their first rollover.
  lastDriftDay: 0,
}))

export const Health = trait({ hp: 100, dead: false })

export const Money = trait({ amount: 0 })

export const Skills = trait({
  mechanics: 0,
  marksmanship: 0,
  athletics: 0,
  cooking: 0,
  medicine: 0,
  computers: 0,
  piloting: 0,
  bartending: 0,
  engineering: 0,
})

export const Inventory = trait({
  water: 0,
  meal: 0,
  // Same hunger payload as meal, but consumed first by eat() and tagged so
  // vitals hands out a charisma feed. Wealthy NPCs preferentially stock
  // these; the destitute never touch them.
  premiumMeal: 0,
  books: 0,
})

export const IsPlayer = trait()
export const QueuedInteract = trait()

// The player always carries Active.
export const Active = trait()

// Stable identity for save/load. Walls/decorative interactables don't need
// keys — setupWorld rebuilds them from the world seed. Keys must be unique
// within a world.
export const EntityKey = trait({ key: '' })

// Asymmetric on purpose — A.Knows(B) does not imply B.Knows(A). Unrequited
// crushes / one-sided grudges must be expressible.
export const Knows = relation({
  store: { opinion: 0, familiarity: 0, lastSeenMs: 0, meetCount: 0 },
})

export type ActionKind = 'idle' | 'walking' | 'eating' | 'sleeping' | 'washing' | 'working' | 'reading' | 'drinking' | 'reveling' | 'chatting' | 'exercising'

export const Action = trait({
  kind: 'idle' as ActionKind,
  remaining: 0,
  total: 0,
})

// 'flop' and 'landlord' aren't here: flop beds use 'sleep' (rent semantics
// differ by Bed.tier, not by kind), and the apartment landlord desk uses
// 'manager' since the player clicks the bed under the per-bed rent model.
export type InteractableKind =
  | 'eat' | 'sleep' | 'wash' | 'work' | 'shop' | 'hr' | 'bar' | 'manager'
  | 'tap' | 'scavenge' | 'rough'
  | 'aeReception'
  | 'gym'
  | 'transit'
  | 'ticketCounter'
  | 'buyShip'
  | 'boardShip'
  | 'disembarkShip'
  | 'openStarmap'

// Tags an actor while using a public/free survival source so vitals can
// apply the per-action penalty (hygiene gain + small HP loss) without a
// spatial lookup every tick.
export type RoughKind = 'tap' | 'scavenge' | 'rough'
export const RoughUse = trait({ kind: 'tap' as RoughKind })

// Asymmetric in storage but symmetric in semantics — both directions are
// always written together. A one-sided ChatTarget is treated as broken by
// chat() and cleared on the next BT tick.
export const ChatTarget = trait(() => ({ partner: null as Entity | null }))

export const ChatLine = trait({ text: '' })

// Without this throttle wander would re-pick every tick and the city would
// never settle into clusters; NPCs need to linger long enough at a
// destination to accumulate co-location time for friendships.
export const WanderState = trait({ nextPickMs: 0 })

export const Interactable = trait({
  kind: 'eat' as InteractableKind,
  label: '',
  fee: 0,
})

export const Building = trait({
  x: 0, y: 0, w: 0, h: 0,
  label: '',
})

// `unemployedSinceMs` 0 = "never observed unemployed" — the stress system
// lazy-inits to the current game time on the first tick it sees an
// unemployed entity, and uses the value to gate the grace period.
export const Job = trait(() => ({
  workstation: null as Entity | null,
  unemployedSinceMs: 0,
}))

export const Home = trait(() => ({ bed: null as Entity | null }))

// Time-bounded exit pass: when rent expires the cell door is logically
// locked against the tenant, but if eviction caught them inside they'd be
// stuck. Pathfinder treats *that specific* cell door as open for them until
// expireMs — long enough to walk out, short enough that they can't loiter back.
export const PendingEviction = trait(() => ({
  bedEntity: null as Entity | null,
  expireMs: 0,
}))

export const JobPerformance = trait({
  todayPerf: 0,
  lastUpdateDay: 0,
  wasInWindow: false,
})

export const Character = trait({
  name: '',
  color: '#cccccc',
  title: '',
})

// Values are concrete, not sentinel-defaults. Generated once at spawn time
// and pinned for the entity's lifetime — no per-render randomization.
// Skin / hair-style strings must come from FC's catalog (see
// helpers/artHelpers.js extractColor and the hair-style list).
export type Gender = 'male' | 'female'

export const Appearance = trait({
  gender: 'female' as Gender,
  physicalAge: 25,
  skin: 'light',
  hStyle: 'neat',
  hLength: 30,                  // 0 (bald) – 150 (very long)
  hColor: 'brown',
  pubicHStyle: 'neat',
  pubicHColor: 'brown',
  underArmHStyle: 'shaved',
  underArmHColor: 'brown',
  eyeIris: 'brown',
  weight: 0,                    // -100..+100; 0 = average
  muscles: 0,                   // -100..+100; 0 = unmuscled
  height: 165,                  // cm
  hips: 0,                      // -2..3
  butt: 2,                      // 0..10
  waist: 0,                     // -100..+100; negative = narrower
  boobs: 350,                   // mass in cc; 0 for male / flat-chested
  lips: 25,                     // 0..100
  makeup: 0,                    // 0 (none) – 8
})

// One shift slot at a workplace. Multiple Workstations may share a Position
// (e.g. shop counter has a morning + evening shift). Static job data
// (title, wage, shift, skill, requirements, description) lives in
// config/jobs.json5 keyed by specId; resolve via getJobSpec(specId).
export const Workstation = trait({
  specId: '',
  occupant: null as Entity | null,
})

export const BarSeat = trait({
  occupant: null as Entity | null,
})

export const RoughSpot = trait({
  occupant: null as Entity | null,
})

export type BedTier = 'flop' | 'dorm' | 'apartment' | 'luxury' | 'lounge'

// `rep` is sparse — only factions the entity has actually interacted with
// carry an entry, so a fresh character reads as "no rep with anyone yet"
// rather than as +0 with every faction. Values clamped to [-100, +100] by
// the addRep helper.
export const Reputation = trait(() => ({
  rep: {} as Partial<Record<FactionId, number>>,
}))

// Counts shifts at the *current* Job.workstation's specId; resets to 0 on
// hire or rank-up so each rank earns its own tenure.
export const JobTenure = trait({
  shiftsAtCurrentRank: 0,
})

export const FactionRole = trait({
  faction: 'civilian' as FactionId,
  role: 'staff' as 'staff' | 'manager' | 'board',
})

export const Transit = trait({
  terminalId: '',
})

export const FlightHub = trait({
  hubId: '',
})

// `owned` is the realtor's purchase outcome — once true, the bed is the
// occupant's permanently. The rent system skips owned beds entirely, so
// rentPaidUntilMs is moot for the rest of the bed's lifetime. Only the
// player can buy under the current model.
export const Bed = trait({
  tier: 'flop' as BedTier,
  nightlyRent: 0,
  occupant: null as Entity | null,
  rentPaidUntilMs: 0,
  owned: false,
})

// Phase 5.0 — long-arc player goals (Sims-style aspiration model).
// Player-only trait.
//
// `active` holds every ambition the player is currently pursuing. There
// is no cap on simultaneous ambitions (per the Sims-pivot in
// Design/social/ambitions.md). Length 0 = not yet picked — AmbitionPanel
// forces open in picker mode until at least one is selected.
//
// `apBalance` is unspent Ambition Points; `apEarned` is lifetime total
// (used for UI display + history). Stage payoffs grant AP; perks are
// bought from the catalog by spending AP. Perks are permanent.
//
// `streakAnchorMs` supports stages whose conditions must hold continuously
// over time (dropout's "365 days at flop with no Job"). The system sets it
// when conditions hold and resets to null when they break.
export interface AmbitionSlot { id: string; currentStage: number; streakAnchorMs: number | null }
export interface AmbitionHistoryEntry { id: string; completedStages: number; droppedAtMs: number | null }

export const Ambitions = trait(() => ({
  active: [] as AmbitionSlot[],
  history: [] as AmbitionHistoryEntry[],
  apBalance: 0,
  apEarned: 0,
  perks: [] as string[],
}))

// String-keyed boolean flags set by ambition stage payoffs (and, later,
// other story beats). Phase 5.0 only writes — no consumers wired yet.
export const Flags = trait(() => ({
  flags: {} as Record<string, boolean>,
}))

// Phase 6.0 — ship-as-scene. The ship interior is a normal koota world (its
// own coordinate space, walls/doors, NPC roster). Ship-wide state is held on
// a single Ship singleton spawned at scene-bootstrap time; per-room and
// per-loadout state ride alongside on dedicated entities.

// Whole-ship state. One per ship-scene world. `dockedAtPoiId` empty string
// means "in flight" (the starmap fleet token is moving along `burnPlan`).
// `fleetPos` is the fleet token's normalized 0..100 position on the Earth
// Sphere campaign map; updated by the starmap tick along the burn plan,
// snapped to a POI when docked.
//
// Starsector-shape combat stats (armor / fluxMax / fluxCurrent / fluxDissipation /
// shieldEfficiency / topSpeed / maneuverability) live here as a single
// flat block — there's only ever one player flagship in 6.0, and a flat
// shape keeps the save/load layer simple.
export type BurnPlan = {
  fromX: number; fromY: number
  toX: number; toY: number
  startedAtMs: number     // game-time ms when the burn began
  arriveAtMs: number      // game-time ms the burn lands; lerp t = (now-start)/(end-start)
  destPoiId: string | null  // null = burn ends in empty space; set = auto-dock on arrival
}
export const Ship = trait({
  classId: '',
  hullCurrent: 0, hullMax: 0,
  armorMax: 0, armorCurrent: 0,
  fluxMax: 0, fluxCurrent: 0,
  fluxDissipation: 0,
  shieldEfficiency: 1,    // multiplier on flux-per-damage (1 = neutral)
  topSpeed: 0,            // map-units/sec equivalent for tactical movement
  maneuverability: 0,     // 0..1, scales turn rate
  fuelCurrent: 0, fuelMax: 0,
  suppliesCurrent: 0, suppliesMax: 0,
  dockedAtPoiId: '',
  fleetPos: { x: 0, y: 0 } as { x: number; y: number },
  burnPlan: null as BurnPlan | null,
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

// Marks an actor (player or crew NPC) currently manning a station. Cleared
// when they leave the room. `roomEntity` is the ShipRoom entity they're at.
export const CrewStation = trait(() => ({
  roomEntity: null as Entity | null,
}))

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
