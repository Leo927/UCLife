// Phase 6.2.5.C sortie-loop traits: per-ship hangar-door cycle state,
// per-MS resupply state, and per-tug recovery state. All three live in
// the playerShipInterior world alongside Ship / Ms, and all three are
// transient combat-time state (not persisted across save/load — per
// Design/sortie.md § Save / load).

import { trait } from 'koota'

// Door state machine — one record per authored hangar door per ship.
// Sits on the Ship entity rather than per-door entities so the resupply
// + recovery-tug systems can look up door state via the ship entity in
// O(1) without scanning a separate world.
//
//   state       — current cycle phase
//   lockSec     — tactical-seconds remaining on the lock (counts down at
//                 sortieConfig.launchDoorLockSec or dockDoorLockSec).
//                 0 means the cycle is complete; the next request flips
//                 state back to 'idle' and the lock fires for the new op.
//   queue       — FIFO of MS entity keys waiting on this door (incoming
//                 launches OR incoming docks). Door count < hangarCapacity
//                 means multiple bays share a door; the queue is how that
//                 shows up at the gameplay layer.
//   occupiedByMsKey — non-empty during a launching / docking cycle so the
//                 tug system can claim and release the door.
export interface DoorState {
  state: 'idle' | 'launching' | 'docking'
  lockSec: number
  queue: string[]
  occupiedByMsKey: string
}

export const HangarDoorStates = trait(() => ({
  byDoorId: {} as Record<string, DoorState>,
}))

// Per-MS resupply state. Present iff the MS is currently inside a hangar
// bay being topped off. Set on dock-cycle completion in hangarDoors.ts;
// removed on resupply-tick complete in sortieResupply.ts. While present
// the MS is unavailable for relaunch (the cockpit launch handler refuses
// until `secRemaining <= 0`).
export const ResupplyState = trait({
  // EntityKey of the ship hosting this resupply bay (so the formula can
  // read hangar-boss / mechanic-crew off the right ship).
  shipKey: '',
  // Which authored door this MS docked through — re-used as the bay
  // anchor for visual placement and as the door to release on relaunch.
  bayDoorId: '',
  secRemaining: 0,
  secTotal: 0,
})

// Per-tug state. Spawned via dispatchTug; despawned at handoff. One tug
// occupies a door for the duration; the door's state stays 'idle' (the
// tug isn't launching/docking) but its `occupiedByMsKey` field is set
// to the tug's own entity key so launch attempts on that door are
// refused.
export const RecoveryTugState = trait({
  shipKey: '',         // parent ship
  bayDoorId: '',       // door the tug launched from
  // Stranded MS — Ms entity key (persistent across launch/dock) +
  // CombatShipState entity key (deployed in tactical). Carrying both
  // means the tick can look up the deployed row to move its pos and
  // the Ms entity to route into resupply at handoff without scanning
  // by discriminator each frame.
  targetMsKey: '',
  targetCsKey: '',
  phase: 'outbound' as 'outbound' | 'grappled' | 'returning' | 'handoff',
  pos: { x: 0, y: 0 } as { x: number; y: number },
})
