import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { WorldProvider } from 'koota/react'
import './styles.css'
import { App } from './App'
import { world, getWorld } from './ecs/world'
import { useScene } from './sim/scene'
import { useClock } from './sim/clock'
import {
  IsPlayer, Position, MoveTarget, Road, Building, Wall, FlightHub, Door, Bed, Path,
  Ambitions, Flags, Character, Attributes, Skills, Money, Reputation, EnemyShipState,
  Course, EnemyAI, EntityKey,
  type AmbitionSlot,
} from './ecs/traits'
import type { FactionId } from './data/factions'
import type { SkillId } from './data/skills'
import { useEventLog } from './ui/EventLog'
import { ambitionsSystem } from './systems/ambitions'
import { getAirportPlacement } from './sim/airportPlacements'
import { flightHubs } from './data/flights'
import { findPath } from './systems/pathfinding'
import { boardShip, disembarkShip } from './sim/scene'
import { getShipState } from './sim/ship'
import { useCombatStore } from './systems/combat'
import { useTransition } from './sim/transition'
import { useEngagement } from './sim/engagement'
// Side-effect imports: install dev-only window.uclifeFindClerk /
// window.uclifePinClerk for Playwright fixtures.
import './render/portrait/adapter/findClerk'
import './render/portrait/__debug__/portraitFixtures'

if (import.meta.env.DEV) {
  // Smoke-test handles. CLAUDE.md: expose helpers here, do NOT
  // dynamic-import traits from tests (module-dedup mismatch).
  ;(globalThis as unknown as { __uclife__: unknown }).__uclife__ = {
    world, useClock, useScene,
    movePlayerTo(tx: number, ty: number) {
      const TILE = 32
      const px = tx * TILE, py = ty * TILE
      for (const e of world.query(IsPlayer, Position)) {
        e.set(Position, { x: px, y: py })
        e.set(MoveTarget, { x: px, y: py })
        return true
      }
      return false
    },
    countByKind() {
      let buildings = 0, walls = 0, roads = 0
      for (const _b of world.query(Building)) buildings++
      for (const _w of world.query(Wall)) walls++
      for (const _r of world.query(Road)) roads++
      return { buildings, walls, roads }
    },
    listAirports() {
      return flightHubs.map((h) => ({
        hubId: h.id,
        sceneId: h.sceneId,
        nameZh: h.nameZh,
        placement: getAirportPlacement(h.id),
      }))
    },
    movePlayerToAirport(hubId: string) {
      const p = getAirportPlacement(hubId)
      if (!p) return false
      for (const e of world.query(IsPlayer, Position)) {
        e.set(Position, p.counterPx)
        e.set(MoveTarget, p.counterPx)
        return true
      }
      return false
    },
    flightHubCount() {
      let n = 0
      for (const _ of world.query(FlightHub)) n++
      return n
    },
    // Probes for the locked-room regression test. Picks the first cell door
    // whose bed has no occupant — i.e., a door currently locked for the
    // player — and returns geometry + the result of pathing into it.
    findLockedCellPath() {
      const player = world.queryFirst(IsPlayer)
      if (!player) return null
      let chosenDoor: { x: number; y: number; w: number; h: number; orient: 'h' | 'v' } | null = null
      let bedPos: { x: number; y: number } | null = null
      for (const dEnt of world.query(Door, Position)) {
        const d = dEnt.get(Door)!
        if (!d.bedEntity) continue
        const bed = d.bedEntity.get(Bed)
        if (!bed) continue
        // "Locked for player" = anyone except the player holds the lease.
        if (bed.occupant === player) continue
        chosenDoor = { x: d.x, y: d.y, w: d.w, h: d.h, orient: d.orient }
        const bp = d.bedEntity.get(Position)
        if (bp) bedPos = { x: bp.x, y: bp.y }
        break
      }
      if (!chosenDoor || !bedPos) return null
      const corridorOff = 24
      const start = chosenDoor.orient === 'h'
        ? { x: chosenDoor.x + chosenDoor.w / 2, y: chosenDoor.y - corridorOff }
        : { x: chosenDoor.x - corridorOff, y: chosenDoor.y + chosenDoor.h / 2 }
      // Try the opposite-side start if the chosen one is inside walls (no
      // path segment from there). The bed gives an oracle for "interior".
      const sameSideAsBed = chosenDoor.orient === 'h'
        ? (start.y < chosenDoor.y) === (bedPos.y < chosenDoor.y)
        : (start.x < chosenDoor.x) === (bedPos.x < chosenDoor.x)
      if (sameSideAsBed) {
        if (chosenDoor.orient === 'h') start.y = chosenDoor.y + chosenDoor.h + corridorOff
        else start.x = chosenDoor.x + chosenDoor.w + corridorOff
      }
      player.set(Position, start)
      player.set(MoveTarget, start)
      const wps = findPath(world, player, start, bedPos)
      const interiorReached = wps.some((wp) =>
        chosenDoor!.orient === 'h'
          ? (bedPos!.y > chosenDoor!.y ? wp.y > chosenDoor!.y + chosenDoor!.h : wp.y < chosenDoor!.y)
          : (bedPos!.x > chosenDoor!.x ? wp.x > chosenDoor!.x + chosenDoor!.w : wp.x < chosenDoor!.x),
      )
      return { door: chosenDoor, bed: bedPos, start, target: bedPos, wps, interiorReached }
    },
    setMoveTarget(target: { x: number; y: number }) {
      const player = world.queryFirst(IsPlayer)
      if (!player) return false
      player.set(MoveTarget, target)
      return true
    },
    playerSnapshot() {
      const player = world.queryFirst(IsPlayer)
      if (!player) return null
      const pos = player.get(Position)!
      const path = player.get(Path)
      return {
        pos: { x: pos.x, y: pos.y },
        pathLen: path?.waypoints.length ?? 0,
        pathIdx: path?.index ?? null,
      }
    },
    // ── Ambition test surface (Phase 5.0) ─────────────────────────────
    getAmbitions() {
      const player = world.queryFirst(IsPlayer, Ambitions)
      if (!player) return null
      const a = player.get(Ambitions)!
      const ch = player.get(Character)
      return {
        active: a.active.map((s) => ({ ...s })),
        history: a.history.map((h) => ({ ...h })),
        apBalance: a.apBalance,
        apEarned: a.apEarned,
        perks: [...a.perks],
        title: ch?.title ?? '',
      }
    },
    getEventLog() {
      return useEventLog.getState().entries.map((e) => ({ ...e }))
    },
    getFlags() {
      const player = world.queryFirst(IsPlayer, Flags)
      if (!player) return {}
      return { ...player.get(Flags)!.flags }
    },
    pickAmbitions(ids: string[]) {
      const player = world.queryFirst(IsPlayer, Ambitions)
      if (!player) return false
      const next: AmbitionSlot[] = ids.map((id) => ({ id, currentStage: 0, streakAnchorMs: null }))
      player.set(Ambitions, {
        active: next, history: [], apBalance: 0, apEarned: 0, perks: [],
      })
      return true
    },
    setPlayerStat(path: string, value: number) {
      const player = world.queryFirst(IsPlayer)
      if (!player) return false
      // Path forms:
      //   'attributes.<key>'        — sets Attributes[key].value
      //   'attributes.<key>.value'  — same as above (explicit)
      //   'skills.<key>'            — sets Skills[key]
      //   'money'                   — sets Money.amount
      //   'reputation.<faction>'    — sets Reputation.rep[faction]
      const segs = path.split('.')
      if (segs[0] === 'attributes' && segs.length >= 2) {
        const key = segs[1]
        const a = player.get(Attributes)
        if (!a) return false
        const stat = a[key as 'strength']
        if (!stat) return false
        stat.value = value
        player.set(Attributes, a)
        return true
      }
      if (segs[0] === 'skills' && segs.length === 2) {
        const s = player.get(Skills)
        if (!s) return false
        ;(s as unknown as Record<SkillId, number>)[segs[1] as SkillId] = value
        player.set(Skills, s)
        return true
      }
      if (segs[0] === 'money' && segs.length === 1) {
        player.set(Money, { amount: value })
        return true
      }
      if (segs[0] === 'reputation' && segs.length === 2) {
        const r = player.get(Reputation)
        const next = r ? { ...r.rep } : {}
        next[segs[1] as FactionId] = value
        if (r) player.set(Reputation, { rep: next })
        else player.add(Reputation({ rep: next }))
        return true
      }
      return false
    },
    advanceGameMinutes(minutes: number) {
      useClock.getState().advance(minutes)
      return true
    },
    advanceGameDays(days: number) {
      useClock.getState().advance(days * 24 * 60)
      return true
    },
    // Forces a single ambitionsSystem evaluation immediately. Tests call this
    // after mutating player traits + clock so they don't have to wait for the
    // RAF loop to consume tickAccum.
    runAmbitionsTick() {
      ambitionsSystem(world, useClock.getState().gameDate)
      return true
    },
    // ── Phase 6.0 Starsector pivot — debug surface ──────────────────
    boardShip,
    disembarkShip,
    getShipState,
    shipFuelSupply() {
      const s = getShipState()
      if (!s) return null
      return { fuel: s.fuelCurrent, supplies: s.suppliesCurrent }
    },
    useCombatStore,
    useTransition,
    enterSpace() { useScene.getState().setActive('spaceCampaign'); return true },
    setCourse(tx: number, ty: number, destPoiId: string | null = null) {
      const w = getWorld('spaceCampaign')
      const e = w.queryFirst(IsPlayer, Course)
      if (!e) return false
      e.set(Course, { tx, ty, destPoiId, active: true })
      return true
    },
    shipPos() {
      const w = getWorld('spaceCampaign')
      const e = w.queryFirst(IsPlayer, Position)
      if (!e) return null
      return { ...e.get(Position)! }
    },
    listEnemies() {
      const w = getWorld('spaceCampaign')
      const out: { key: string; pos: { x: number; y: number }; mode: string }[] = []
      for (const e of w.query(EnemyAI, Position, EntityKey)) {
        out.push({
          key: e.get(EntityKey)!.key,
          pos: { ...e.get(Position)! },
          mode: e.get(EnemyAI)!.mode,
        })
      }
      return out
    },
    useEngagement,
    setShipOwned() {
      const p = world.queryFirst(IsPlayer)
      if (!p) return false
      const f = p.get(Flags) ?? { flags: {} }
      p.set(Flags, { flags: { ...f.flags, shipOwned: true } })
      return true
    },
    cheatMoney(n: number) {
      const p = world.queryFirst(IsPlayer)
      if (!p) return false
      p.set(Money, { amount: n })
      return true
    },
    cheatPiloting(n: number) {
      const p = world.queryFirst(IsPlayer)
      if (!p) return false
      const s = p.get(Skills)
      if (!s) return false
      ;(s as unknown as Record<SkillId, number>).piloting = n
      p.set(Skills, s)
      return true
    },
    // Smoke-test shortcut: zero the enemy hull so combatSystem's resolution
    // check ends combat with 'victory' on the next tick. Keeps the smoke
    // test deterministic without driving the weapon-charge state machine.
    fastWinCombat() {
      const w = getWorld('playerShipInterior')
      const enemy = w.queryFirst(EnemyShipState)
      if (!enemy) return false
      const cur = enemy.get(EnemyShipState)!
      enemy.set(EnemyShipState, { ...cur, hullCurrent: 0 })
      return true
    },
  }
}

// Bind WorldProvider to the *real* active-scene World, not the proxy — the
// proxy's identity never changes, so passing it would pin koota subscriptions
// to the previous scene. The composite `${activeId}-${swapNonce}` key forces
// a full remount on every useScene.setActive() call, not just scene swaps:
// koota's `world.reset()` clears its queriesHashMap, orphaning existing
// useQuery instances (their state never sees post-reset spawns). Save/load
// reuses the same scene, so it bumps swapNonce — the changing key gives App
// fresh useQuery hooks that re-scan the rebuilt world.
function ScopedRoot() {
  const activeId = useScene((s) => s.activeId)
  const swapNonce = useScene((s) => s.swapNonce)
  const sceneWorld = getWorld(activeId)
  return (
    <WorldProvider world={sceneWorld}>
      <App key={`${activeId}-${swapNonce}`} />
    </WorldProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ScopedRoot />
  </StrictMode>,
)
