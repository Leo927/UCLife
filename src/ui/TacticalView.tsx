// Fullscreen Starsector-shape tactical combat overlay. The Pixi canvas
// fills the viewport; the HUD is a set of corner overlays (player stats
// top-left, enemy stats top-right, weapon queue bottom-center, controls
// top-center). Combat traits are polled at 30Hz off the playerShipInterior
// world — useTrait/useQuery are bound to the active scene's WorldProvider,
// which may be elsewhere when combat opens, so we can't use them here.

import { useEffect, useRef, useState } from 'react'
import type { Application } from 'pixi.js'
import {
  useCombatStore, ARENA_W, ARENA_H,
  getCombatPlayerPos, getCombatPlayerHeading, getBeamFlashes,
  withdrawFromCombat,
} from '../systems/combat'
import { useCombatLog, type CombatLogEntry } from '../sim/combatLog'
import { simNow } from '../sim/time'
import { combatConfig, fleetConfig } from '../config'
import { getWorld } from '../ecs/world'
import { Ship, WeaponMount, CombatShipState, EntityKey, IsFlagshipMark } from '../ecs/traits'
import { getShipClass } from '../data/ship-classes'
import { getWeapon } from '../data/weapons'
import { PixiCanvas } from '../render/pixi'
import {
  PixiTacticalRenderer,
  type ShipSnap as PixiShipSnap,
  type EnemyShipSnap as PixiEnemyShipSnap,
  type BeamFlashVisual,
} from '../render/space/PixiTacticalRenderer'
import { playUi } from '../audio/player'
import {
  useCockpit, dockMs, leaveBridge,
} from '../sim/cockpit'
import { emitSim } from '../sim/events'
import { issueRally, issueFocusFire, issueRegroup } from '../systems/fleetOrders'
import { commandPoolDescribe, type OrderResult } from '../systems/fleetCommandPoints'

const SHIP_SCENE_ID = 'playerShipInterior'

// W2 command layer — order palette click-target mode. `rally`/`focusFire`
// arm the next arena click to resolve the order; `null` is idle (normal
// WASD/aim input). Lives as component state so both the palette buttons and
// the arena click/cancel handlers below read and clear the same value.
// `withdraw` (W2 Task 3) doesn't arm a click-target — it arms a two-step
// confirm on the button itself (misclicking 撤退 would be rage-inducing);
// any arena click, Esc, or right-click while armed cancels it instead of
// resolving an order.
type PendingOrder = 'rally' | 'focusFire' | 'withdraw' | null

// W2 Task 3 — shared misclick guard for the two withdraw entry points (the
// order palette button and the topbar quick-verb): first click arms the
// confirm state, a second click on either button within
// combatConfig.withdrawConfirmWindowMs commits. Both buttons read/write the
// same pendingOrder state lifted to TacticalView so arming one reflects on
// the other.
function onWithdrawClick(pendingOrder: PendingOrder, setPendingOrder: (o: PendingOrder) => void): void {
  if (pendingOrder === 'withdraw') {
    playUi('ui.tactical.order-issue')
    withdrawFromCombat()
    setPendingOrder(null)
    return
  }
  playUi('ui.tactical.order-pick')
  setPendingOrder('withdraw')
}

function orderRefusalZh(reason: 'unknown_order' | 'insufficient_cp'): string {
  return reason === 'insufficient_cp' ? '指挥点不足 · 指令未下达' : '未知指令'
}

// Toast the refusal reason; a successful order already narrates itself via
// fleetOrders.ts's pushCombatLog call, so there's nothing to do on success.
function reportOrderRefusal(result: OrderResult): void {
  if (!result.ok) emitSim('toast', { textZh: orderRefusalZh(result.reason) })
}

interface PlayerSnap {
  templateId: string
  pos: { x: number; y: number }
  heading: number
  hullCurrent: number; hullMax: number
  armorCurrent: number; armorMax: number
  fluxCurrent: number; fluxMax: number
  crCurrent: number; crMax: number
  topSpeed: number
  hasShield: boolean
  mounts: { mountIdx: number; weaponId: string; chargeSec: number; ready: boolean }[]
}

interface EnemySnap {
  /** Stable key from EntityKey trait — drives the renderer's per-ship
   *  Pixi node map and the HUD list keys. */
  key: string
  /** Numeric id derived from the key for renderer node tracking. */
  id: number
  shipClassId: string
  nameZh: string
  pos: { x: number; y: number }
  heading: number
  hullCurrent: number; hullMax: number
  armorCurrent: number; armorMax: number
  fluxCurrent: number; fluxMax: number
  hasShield: boolean
  shieldUp: boolean
}

function snapshotPlayer(): PlayerSnap | null {
  const w = getWorld(SHIP_SCENE_ID)
  const shipEnt = w.queryFirst(Ship, IsFlagshipMark)
  if (!shipEnt) return null
  const s = shipEnt.get(Ship)!
  const mounts: PlayerSnap['mounts'] = []
  for (const e of w.query(WeaponMount)) {
    const m = e.get(WeaponMount)!
    mounts.push({
      mountIdx: m.mountIdx,
      weaponId: m.weaponId,
      chargeSec: m.chargeSec,
      ready: m.ready,
    })
  }
  mounts.sort((a, b) => a.mountIdx - b.mountIdx)
  return {
    templateId: s.templateId,
    pos: getCombatPlayerPos(),
    heading: getCombatPlayerHeading(),
    hullCurrent: s.hullCurrent, hullMax: s.hullMax,
    armorCurrent: s.armorCurrent, armorMax: s.armorMax,
    fluxCurrent: s.fluxCurrent, fluxMax: s.fluxMax,
    crCurrent: s.crCurrent, crMax: s.crMax,
    topSpeed: s.topSpeed,
    hasShield: s.hasShield,
    mounts,
  }
}

// Hash an EntityKey string into a stable numeric id for renderer
// bookkeeping. Different keys collide rarely enough that the renderer's
// per-id Map lookup stays correct; collisions would just cause two
// nodes to share Pixi state, not a crash.
function hashKey(key: string): number {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0
  return h
}

function snapshotEnemies(): EnemySnap[] {
  const w = getWorld(SHIP_SCENE_ID)
  const out: EnemySnap[] = []
  for (const e of w.query(CombatShipState)) {
    const s = e.get(CombatShipState)!
    // Skip flagship + any player-side unit (MS) — they have their own
    // HUD paths.
    if (s.isFlagship || s.isPlayer || s.side === 'player') continue
    const ek = e.get(EntityKey)
    const key = ek ? ek.key : `enemy-${out.length}`
    out.push({
      key,
      id: hashKey(key),
      shipClassId: s.shipClassId,
      nameZh: s.nameZh,
      pos: { x: s.pos.x, y: s.pos.y },
      heading: s.heading,
      hullCurrent: s.hullCurrent, hullMax: s.hullMax,
      armorCurrent: s.armorCurrent, armorMax: s.armorMax,
      fluxCurrent: s.fluxCurrent, fluxMax: s.fluxMax,
      hasShield: s.hasShield,
      shieldUp: s.shieldUp,
    })
  }
  return out
}

// Focus-fire click-target resolution: nearest enemy snapshot to the clicked
// world point, within combatConfig.orderPickRadiusPx. Null when nothing is
// close enough — the caller cancels the order rather than guessing.
function nearestEnemyWithinPickRadius(point: { x: number; y: number }, enemies: EnemySnap[]): EnemySnap | null {
  let best: EnemySnap | null = null
  let bestDist = combatConfig.orderPickRadiusPx
  for (const e of enemies) {
    const d = Math.hypot(e.pos.x - point.x, e.pos.y - point.y)
    if (d <= bestDist) {
      best = e
      bestDist = d
    }
  }
  return best
}

interface MsSnap {
  key: string
  id: number
  nameZh: string
  pos: { x: number; y: number }
  heading: number
  hullCurrent: number; hullMax: number
  armorCurrent: number; armorMax: number
}

function snapshotPlayerMs(): MsSnap | null {
  const w = getWorld(SHIP_SCENE_ID)
  for (const e of w.query(CombatShipState)) {
    const s = e.get(CombatShipState)!
    if (!s.isMs) continue
    const ek = e.get(EntityKey)
    const key = ek ? ek.key : 'player-ms'
    return {
      key,
      id: hashKey(key),
      nameZh: s.nameZh,
      pos: { x: s.pos.x, y: s.pos.y },
      heading: s.heading,
      hullCurrent: s.hullCurrent, hullMax: s.hullMax,
      armorCurrent: s.armorCurrent, armorMax: s.armorMax,
    }
  }
  return null
}

function StatBar(props: { label: string; current: number; max: number; color: string }) {
  const pct = props.max > 0 ? Math.max(0, Math.min(100, (props.current / props.max) * 100)) : 0
  return (
    <div className="tactical-stat">
      <div className="tactical-stat-row">
        <span className="tactical-stat-label">{props.label}</span>
        <span className="tactical-stat-value">{Math.round(props.current)} / {props.max}</span>
      </div>
      <div className="tactical-stat-track">
        <div
          className="tactical-stat-fill"
          style={{ width: `${pct}%`, background: props.color }}
        />
      </div>
    </div>
  )
}

function ChargeBar(props: { pct: number; ready: boolean }) {
  return (
    <div className="tactical-charge">
      <div
        className={`tactical-charge-fill${props.ready ? ' is-ready' : ''}`}
        style={{ width: `${Math.max(0, Math.min(100, props.pct * 100))}%` }}
      />
    </div>
  )
}

function PlayerHud(props: { title: string; snap: PlayerSnap }) {
  const { title, snap } = props
  return (
    <div className="tactical-hud tactical-hud-player">
      <div className="tactical-hud-title">{title}</div>
      <StatBar label="船体" current={snap.hullCurrent} max={snap.hullMax} color="#4ade80" />
      <StatBar label="装甲" current={snap.armorCurrent} max={snap.armorMax} color="#a3a3a3" />
      <StatBar label="电荷" current={snap.fluxCurrent} max={snap.fluxMax} color="#3b82f6" />
      <StatBar label="战备" current={snap.crCurrent} max={snap.crMax} color="#f59e0b" />
    </div>
  )
}

function PlayerMsHud(props: { snap: MsSnap }) {
  const { snap } = props
  return (
    <div className="tactical-hud tactical-hud-ms">
      <div className="tactical-hud-title">{snap.nameZh}</div>
      <StatBar label="船体" current={snap.hullCurrent} max={snap.hullMax} color="#60a5fa" />
      <StatBar label="装甲" current={snap.armorCurrent} max={snap.armorMax} color="#a3a3a3" />
    </div>
  )
}

function EnemyHud(props: { title: string; snap: EnemySnap }) {
  const { title, snap } = props
  return (
    <div className="tactical-hud tactical-hud-enemy">
      <div className="tactical-hud-title">
        {title}
        {snap.hasShield && (
          <span className={`tactical-shield-pip${snap.shieldUp ? ' is-up' : ''}`}>
            {snap.shieldUp ? '护盾·开' : '护盾·关'}
          </span>
        )}
      </div>
      <StatBar label="船体" current={snap.hullCurrent} max={snap.hullMax} color="#dc2626" />
      <StatBar label="装甲" current={snap.armorCurrent} max={snap.armorMax} color="#a3a3a3" />
      <StatBar label="电荷" current={snap.fluxCurrent} max={snap.fluxMax} color="#3b82f6" />
    </div>
  )
}

function playerVisual(p: PlayerSnap): PixiShipSnap {
  const shieldHeadroom = p.fluxMax > 0 ? 1 - p.fluxCurrent / p.fluxMax : 0
  return {
    x: p.pos.x, y: p.pos.y,
    heading: p.heading,
    hullRadius: 18,
    shieldRadius: 32,
    color: 0x4ade80,
    shieldAlpha: p.hasShield ? 0.15 + 0.55 * Math.max(0, shieldHeadroom) : 0,
  }
}

function enemyVisual(e: EnemySnap): PixiEnemyShipSnap {
  const shieldHeadroom = e.fluxMax > 0 ? 1 - e.fluxCurrent / e.fluxMax : 0
  return {
    id: e.id,
    x: e.pos.x, y: e.pos.y,
    heading: e.heading,
    hullRadius: 16,
    shieldRadius: 28,
    color: 0xdc2626,
    shieldAlpha: e.hasShield && e.shieldUp ? 0.15 + 0.55 * Math.max(0, shieldHeadroom) : 0,
  }
}

function playerMsVisual(m: MsSnap): PixiShipSnap {
  return {
    x: m.pos.x, y: m.pos.y,
    heading: m.heading,
    // Smaller hull than the freighter (18) so the MS reads as a fast,
    // small unit alongside the lumbering ship.
    hullRadius: 11,
    shieldRadius: 18,
    color: 0x60a5fa,    // friendly blue — distinct from the green flagship
    shieldAlpha: 0,     // 6.1: MS has no shield model
  }
}

function beamVisuals(): BeamFlashVisual[] {
  return getBeamFlashes().map((b) => ({
    id: b.id,
    fromX: b.from.x, fromY: b.from.y,
    toX: b.to.x, toY: b.to.y,
    alpha: Math.max(0, 1 - b.ageMs / b.lifetimeMs),
    ownerSide: b.ownerSide,
  }))
}

export function TacticalView() {
  const open = useCombatStore((s) => s.open)
  const paused = useCombatStore((s) => s.paused)
  const lastFlashZh = useCombatStore((s) => s.lastFlashZh)
  const lastFlashAtMs = useCombatStore((s) => s.lastFlashAtMs)
  const [tick, setTick] = useState(0)
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight })
  const [pendingOrder, setPendingOrder] = useState<PendingOrder>(null)

  const rendererRef = useRef<PixiTacticalRenderer | null>(null)
  const sizeRef = useRef(size)
  sizeRef.current = size
  // Mirrors pendingOrder for the keydown effect below, whose closure is
  // fixed at mount (deps=[open]) and would otherwise only ever see the
  // initial `null`.
  const pendingOrderRef = useRef(pendingOrder)
  pendingOrderRef.current = pendingOrder

  // W2 Task 3 — the armed withdraw confirm auto-disarms after
  // combatConfig.withdrawConfirmWindowMs so a "confirm?" button never sits
  // armed indefinitely if the player walks away from the decision.
  useEffect(() => {
    if (pendingOrder !== 'withdraw') return
    const id = window.setTimeout(() => setPendingOrder(null), combatConfig.withdrawConfirmWindowMs)
    return () => window.clearTimeout(id)
  }, [pendingOrder])

  useEffect(() => {
    if (!open) return
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [open])

  useEffect(() => {
    const r = rendererRef.current
    if (r) r.resize(size.w, size.h)
  }, [size])

  useEffect(() => {
    if (!open) return
    let raf = 0
    let last = 0
    const loop = (now: number) => {
      if (now - last >= 33) {
        last = now
        setTick((t) => (t + 1) & 0xffff)
        const r = rendererRef.current
        if (r) {
          const p = snapshotPlayer()
          const enemies = snapshotEnemies()
          const ms = snapshotPlayerMs()
          const projectiles = useCombatStore.getState().getProjectiles()
          r.update({
            arenaW: ARENA_W, arenaH: ARENA_H,
            player: p ? playerVisual(p) : null,
            playerMs: ms ? playerMsVisual(ms) : null,
            enemies: enemies.map(enemyVisual),
            projectiles: projectiles.map((pj) => ({
              id: pj.id, x: pj.x, y: pj.y, ownerSide: pj.ownerSide,
            })),
            beams: beamVisuals(),
          })
        }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [open])

  // Starsector-shape input: WASD drives ship-relative thrust (forward/strafe);
  // holding Shift makes the helm orient to the mouse cursor instead of the
  // default auto-face-enemy behavior. Capture-phase + stopPropagation keeps
  // these keys out of the ground-game's WASD walker (Game.tsx) while combat
  // is open. We track the held set in a ref and push the resolved axis into
  // the combat store on every transition.
  useEffect(() => {
    if (!open) return
    const held = new Set<'w' | 's' | 'a' | 'd'>()
    const flush = () => {
      let forward = 0
      let strafe = 0
      if (held.has('w')) forward += 1
      if (held.has('s')) forward -= 1
      if (held.has('d')) strafe += 1
      if (held.has('a')) strafe -= 1
      useCombatStore.getState().setInputAxis({ forward, strafe })
    }
    const map = (code: string): 'w' | 's' | 'a' | 'd' | null => {
      switch (code) {
        case 'KeyW': return 'w'
        case 'KeyS': return 's'
        case 'KeyA': return 'a'
        case 'KeyD': return 'd'
        default: return null
      }
    }
    const onKeyDown = (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      if (ev.code === 'Escape') {
        if (pendingOrderRef.current) {
          ev.preventDefault()
          playUi('ui.tactical.order-cancel')
          setPendingOrder(null)
        }
        return
      }
      if (ev.code === 'Space') {
        ev.preventDefault()
        useCombatStore.getState().togglePause()
        return
      }
      if (ev.code === 'Tab') {
        ev.preventDefault()
        useCombatLog.getState().toggleHistory()
        return
      }
      if (ev.code === 'ShiftLeft' || ev.code === 'ShiftRight') {
        useCombatStore.getState().setAimAtMouse(true)
        return
      }
      const k = map(ev.code)
      if (!k) return
      ev.preventDefault()
      ev.stopPropagation()
      if (held.has(k)) return
      held.add(k)
      flush()
    }
    const onKeyUp = (ev: KeyboardEvent) => {
      if (ev.code === 'ShiftLeft' || ev.code === 'ShiftRight') {
        useCombatStore.getState().setAimAtMouse(false)
        return
      }
      const k = map(ev.code)
      if (!k) return
      ev.stopPropagation()
      held.delete(k)
      flush()
    }
    const onBlur = () => {
      held.clear()
      flush()
      useCombatStore.getState().setAimAtMouse(false)
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    window.addEventListener('keyup', onKeyUp, { capture: true })
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true } as AddEventListenerOptions)
      window.removeEventListener('keyup', onKeyUp, { capture: true } as AddEventListenerOptions)
      window.removeEventListener('blur', onBlur)
      useCombatStore.getState().setInputAxis({ forward: 0, strafe: 0 })
      useCombatStore.getState().setAimAtMouse(false)
      useCombatStore.getState().setAimMouse(null)
      setPendingOrder(null)
    }
  }, [open])

  // Tear down renderer when the overlay closes — its parent unmounts the
  // PixiCanvas, but the renderer holds DisplayObjects we created on top of
  // the app.stage that should be released too.
  useEffect(() => {
    if (open) return
    const r = rendererRef.current
    if (r) {
      r.destroy()
      rendererRef.current = null
    }
  }, [open])

  if (!open) return null
  void tick

  const player = snapshotPlayer()
  const enemies = snapshotEnemies()
  const ms = snapshotPlayerMs()
  if (!player || enemies.length === 0) return null

  const flashAge = simNow() - lastFlashAtMs
  const showFlash = lastFlashZh && flashAge < 1500

  // Mouse over arena: track cursor in arena world coords. The combat tick
  // only consults this when shift is held (aimAtMouse=true); otherwise the
  // helm holds its current orientation — there is no auto-face fallback.
  const onArenaMouseMove = (ev: React.MouseEvent<HTMLDivElement>) => {
    const r = rendererRef.current
    if (!r) return
    const rect = ev.currentTarget.getBoundingClientRect()
    const sx = ev.clientX - rect.left
    const sy = ev.clientY - rect.top
    const wp = r.screenToWorld(sx, sy)
    useCombatStore.getState().setAimMouse({ x: wp.x, y: wp.y })
  }

  // Order palette click-target mode (W2 Task 2): the next arena left-click
  // while a rally/focus-fire order is pending resolves it — rally takes the
  // clicked world point directly; focus-fire resolves to the nearest enemy
  // snapshot within orderPickRadiusPx, or cancels with a toast if nothing's
  // close enough. Either way the mode clears on this click; a spent CP is
  // never refunded by re-canceling after the fact (issue* already debited).
  // withdraw (W2 Task 3) isn't a click-target order — any arena click while
  // its confirm is armed just cancels it, same as Esc/right-click.
  const onArenaClick = (ev: React.MouseEvent<HTMLDivElement>) => {
    if (!pendingOrder) return
    const order = pendingOrder
    setPendingOrder(null)
    if (order === 'withdraw') {
      playUi('ui.tactical.order-cancel')
      return
    }
    const r = rendererRef.current
    if (!r) return
    const rect = ev.currentTarget.getBoundingClientRect()
    const world = r.screenToWorld(ev.clientX - rect.left, ev.clientY - rect.top)
    if (order === 'rally') {
      playUi('ui.tactical.order-issue')
      reportOrderRefusal(issueRally(world))
      return
    }
    const target = nearestEnemyWithinPickRadius(world, enemies)
    if (!target) {
      playUi('ui.tactical.order-cancel')
      emitSim('toast', { textZh: '未发现目标 · 集火指令已取消' })
      return
    }
    playUi('ui.tactical.order-issue')
    reportOrderRefusal(issueFocusFire(target.key))
  }

  // Right-click cancels click-target mode (mirrors Esc) instead of opening
  // the browser context menu, which has no use in the tactical overlay.
  const onArenaContextMenu = (ev: React.MouseEvent<HTMLDivElement>) => {
    ev.preventDefault()
    if (!pendingOrder) return
    playUi('ui.tactical.order-cancel')
    setPendingOrder(null)
  }

  const onPixiReady = (app: Application) => {
    const sz = sizeRef.current
    rendererRef.current = new PixiTacticalRenderer(app, sz.w, sz.h, ARENA_W, ARENA_H)
  }

  const playerCls = getShipClass(player.templateId)
  const isClickTargetOrder = pendingOrder === 'rally' || pendingOrder === 'focusFire'
  const hintZh = pendingOrder === 'rally'
    ? '点击战场选择集结坐标 · Esc / 右键取消'
    : pendingOrder === 'focusFire'
      ? '点击战场选择集火目标 · Esc / 右键取消'
      : pendingOrder === 'withdraw'
        ? '再次点击撤退按钮确认撤退 · 点击战场 / Esc / 右键取消'
        : 'WASD 操控当前驾驶单位 · 按住 Shift 让船头追随鼠标 · 武器在敌舰进入射程与射界时自动开火 · 空格切换暂停 · Tab 查看战斗日志 · 下舰桥到机库可登 MS 出击'

  return (
    <div className="tactical-overlay">
      <div
        className={`tactical-canvas-host${isClickTargetOrder ? ' is-targeting' : ''}`}
        onMouseMove={onArenaMouseMove}
        onClick={onArenaClick}
        onContextMenu={onArenaContextMenu}
      >
        <PixiCanvas
          width={size.w}
          height={size.h}
          background={0x070710}
          hostStyle={{ width: '100%', height: '100%' }}
          onReady={onPixiReady}
        />
      </div>

      <CombatLogPanel />
      <CombatLogHistory />

      <CockpitTopbar
        paused={paused}
        flagshipName={playerCls.nameZh}
        msName={ms?.nameZh ?? null}
        pendingOrder={pendingOrder}
        setPendingOrder={setPendingOrder}
      />
      <OrderPalette pendingOrder={pendingOrder} setPendingOrder={setPendingOrder} />

      <PlayerHud title={playerCls.nameZh} snap={player} />
      {ms && <PlayerMsHud snap={ms} />}
      <div className="tactical-enemy-stack">
        {enemies.map((en) => (
          <EnemyHud key={en.key} title={en.nameZh} snap={en} />
        ))}
      </div>

      {showFlash && <div className="tactical-flash">{lastFlashZh}</div>}

      <div className="tactical-weapons">
        <div className="tactical-section-title">武器队列</div>
        {player.mounts.map((m) => {
          if (!m.weaponId) {
            return (
              <div key={m.mountIdx} className="tactical-weapon-row is-empty">
                <span className="tactical-muted">挂载位 {m.mountIdx + 1} · 空</span>
              </div>
            )
          }
          const def = getWeapon(m.weaponId)
          const pct = def.chargeSec > 0 ? m.chargeSec / def.chargeSec : 0
          return (
            <div key={m.mountIdx} className="tactical-weapon-row">
              <div className="tactical-weapon-name">
                {def.nameZh}
                {m.ready && <span className="tactical-weapon-ready"> · 就绪</span>}
              </div>
              <ChargeBar pct={pct} ready={m.ready} />
            </div>
          )
        })}
      </div>

      <div className="tactical-hint">{hintZh}</div>
    </div>
  )
}

// Top-left fading combat log scroll — Phase 6.0. Reads from
// useCombatLog and re-renders at 4Hz to drive the visible-window fade
// (entries older than combatConfig.logVisibleSec start fading out and
// drop from the visible scroll once their fade window completes).
function CombatLogPanel() {
  const entries = useCombatLog((s) => s.entries)
  const historyOpen = useCombatLog((s) => s.historyOpen)
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => (t + 1) & 0xffff), 250)
    return () => window.clearInterval(id)
  }, [])

  if (historyOpen) return null

  const now = performance.now()
  const visibleMs = combatConfig.logVisibleSec * 1000
  const fadeMs = combatConfig.logFadeSec * 1000
  const live: { e: CombatLogEntry; opacity: number }[] = []
  for (const e of entries) {
    const age = now - e.pushedAtMs
    if (age >= visibleMs + fadeMs) continue
    const opacity = age <= visibleMs ? 1 : Math.max(0, 1 - (age - visibleMs) / fadeMs)
    live.push({ e, opacity })
  }
  if (live.length === 0) return null

  return (
    <div className="combat-log">
      {live.map(({ e, opacity }) => (
        <div
          key={e.id}
          className={`combat-log-entry is-${e.severity}`}
          style={{ opacity }}
        >
          {e.textZh}
        </div>
      ))}
      <div className="combat-log-tab-hint">TAB · 查看完整日志</div>
    </div>
  )
}

// Phase 6.1 — top bar: pause toggle + Bridge ↔ Cockpit verbs.
// Visibility rules per piloting state:
//   piloting='flagship' : show "下舰桥" (close overlay; flagship → AI).
//                         No MS verb here — the player has to walk to
//                         the hangar interactable to launch.
//   piloting='ms'       : show "返航 (回收 MS)". Disabled until the MS
//                         is within docking proximity of the flagship.
//   piloting=null       : the overlay was closed externally (e.g. by
//                         leaveBridge); shouldn't normally render here
//                         since we early-return on !open above.
// W2 Task 3 — the topbar 撤退 verb requires flagship comm authority.
// Fleet-withdraw is a bridge order, not an emergency MS-override disengage.
// Only the flagship's comm suite can terminate the entire engagement; MS
// pilots dock back personally via 返航.
function CockpitTopbar(props: {
  paused: boolean
  flagshipName: string
  msName: string | null
  pendingOrder: PendingOrder
  setPendingOrder: (o: PendingOrder) => void
}) {
  const piloting = useCockpit((s) => s.piloting)
  const togglePause = () => { playUi('ui.tactical.toggle-pause'); useCombatStore.getState().togglePause() }
  const onLeaveBridge = () => { playUi('ui.tactical.toggle-pause'); leaveBridge() }
  const onDock = () => {
    playUi('ui.tactical.toggle-pause')
    const r = dockMs()
    if (!r.ok && r.reasonZh) emitSim('toast', { textZh: r.reasonZh })
  }

  const pilotingLabel = piloting === 'ms'
    ? `驾驶 · ${props.msName ?? 'MS'}`
    : piloting === 'flagship'
      ? `驾驶 · ${props.flagshipName}`
      : '旁观'

  // W2 Task 2 — CP gauge. commandPoolDescribe() reads the zustand pool
  // directly; the 30Hz `tick` poll in TacticalView already forces this
  // subtree to re-render, so no separate subscription is needed here.
  const cp = commandPoolDescribe()
  const withdrawArmed = props.pendingOrder === 'withdraw'

  return (
    <div className="tactical-topbar">
      <div className="tactical-title">战术指挥</div>
      <div className="tactical-piloting">{pilotingLabel}</div>
      <div className="tactical-cp-gauge" data-tactical-cp={`${cp.current}/${cp.max}`}>
        指挥点 {cp.current}/{cp.max}
      </div>
      <div className={`tactical-pause-state${props.paused ? ' is-paused' : ''}`}>
        {props.paused ? '已暂停 ⏸' : '运行中 ▶'}
      </div>
      <button className="tactical-btn" onClick={togglePause}>
        {props.paused ? '继续 (空格)' : '暂停 (空格)'}
      </button>
      {piloting === 'flagship' && (
        <button className="tactical-btn" onClick={onLeaveBridge}>下舰桥</button>
      )}
      {piloting === 'ms' && (
        <button className="tactical-btn" onClick={onDock}>返航 (回收)</button>
      )}
      {piloting === 'flagship' && (
        <button
          className={`tactical-btn${withdrawArmed ? ' is-pending' : ''}`}
          data-tactical-topbar-withdraw="true"
          onClick={() => onWithdrawClick(props.pendingOrder, props.setPendingOrder)}
        >
          {withdrawArmed ? '撤退 · 确认?' : '撤退'}
        </button>
      )}
    </div>
  )
}

// W2 Task 2 — fleet-order palette. Only rendered while piloting the
// flagship: an MS pilot mid-sortie has no comm authority over the rest of
// the fleet (that's the flagship's comm suite, per fleetCommandPoints.ts's
// header). Rally/focus-fire arm click-target mode (resolved by
// TacticalView's onArenaClick); regroup and withdraw are one-shot.
function OrderPalette(props: { pendingOrder: PendingOrder; setPendingOrder: (o: PendingOrder) => void }) {
  const piloting = useCockpit((s) => s.piloting)
  if (piloting !== 'flagship') return null

  const costs = fleetConfig.commandPoints.orderCosts

  const onRally = () => {
    playUi('ui.tactical.order-pick')
    props.setPendingOrder('rally')
  }
  const onFocusFire = () => {
    playUi('ui.tactical.order-pick')
    props.setPendingOrder('focusFire')
  }
  const onRegroup = () => {
    props.setPendingOrder(null)
    playUi('ui.tactical.order-issue')
    reportOrderRefusal(issueRegroup())
  }

  return (
    <div className="tactical-order-palette">
      <button
        className={`tactical-btn tactical-order-btn${props.pendingOrder === 'rally' ? ' is-pending' : ''}`}
        data-tactical-order="rally"
        onClick={onRally}
      >
        集结 · {costs.rally} CP
      </button>
      <button
        className={`tactical-btn tactical-order-btn${props.pendingOrder === 'focusFire' ? ' is-pending' : ''}`}
        data-tactical-order="focusFire"
        onClick={onFocusFire}
      >
        集火 · {costs.focusFire} CP
      </button>
      <button
        className="tactical-btn tactical-order-btn"
        data-tactical-order="regroup"
        onClick={onRegroup}
      >
        重整队形 · {costs.formationChange} CP
      </button>
      <button
        className={`tactical-btn tactical-order-btn${props.pendingOrder === 'withdraw' ? ' is-pending' : ''}`}
        data-tactical-order="withdraw"
        onClick={() => onWithdrawClick(props.pendingOrder, props.setPendingOrder)}
      >
        {props.pendingOrder === 'withdraw' ? '撤退 · 确认?' : '撤退'}
      </button>
    </div>
  )
}

// Tab-toggled full-history scroll — all entries from the current
// engagement, regardless of age. Cleared by startCombat at the next
// engagement.
function CombatLogHistory() {
  const entries = useCombatLog((s) => s.entries)
  const open = useCombatLog((s) => s.historyOpen)
  if (!open) return null
  return (
    <div className="combat-log-history">
      <h3>战斗日志 · 全程</h3>
      {entries.length === 0 && (
        <div className="tactical-muted">尚无事件。</div>
      )}
      {entries.map((e) => (
        <div key={e.id} className={`combat-log-entry is-${e.severity}`}>
          {e.textZh}
        </div>
      ))}
    </div>
  )
}
