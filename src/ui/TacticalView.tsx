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
} from '../systems/combat'
import { useCombatLog, type CombatLogEntry } from '../systems/combatLog'
import { combatConfig } from '../config'
import { getWorld } from '../ecs/world'
import { Ship, WeaponMount, CombatShipState, EntityKey } from '../ecs/traits'
import { getShipClass } from '../data/ships'
import { getWeapon } from '../data/weapons'
import { PixiCanvas } from '../render/pixi'
import {
  PixiTacticalRenderer,
  type ShipSnap as PixiShipSnap,
  type EnemyShipSnap as PixiEnemyShipSnap,
  type BeamFlashVisual,
} from '../render/space/PixiTacticalRenderer'
import { playUi } from '../audio/player'

const SHIP_SCENE_ID = 'playerShipInterior'

interface PlayerSnap {
  classId: string
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
  const shipEnt = w.queryFirst(Ship)
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
    classId: s.classId,
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
    if (s.isPlayer) continue   // player ship has its own HUD path
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

  const rendererRef = useRef<PixiTacticalRenderer | null>(null)
  const sizeRef = useRef(size)
  sizeRef.current = size

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
          const projectiles = useCombatStore.getState().getProjectiles()
          r.update({
            arenaW: ARENA_W, arenaH: ARENA_H,
            player: p ? playerVisual(p) : null,
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
  if (!player || enemies.length === 0) return null

  const flashAge = performance.now() - lastFlashAtMs
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

  const onPixiReady = (app: Application) => {
    const sz = sizeRef.current
    rendererRef.current = new PixiTacticalRenderer(app, sz.w, sz.h, ARENA_W, ARENA_H)
  }

  const playerCls = getShipClass(player.classId)

  return (
    <div className="tactical-overlay">
      <div className="tactical-canvas-host" onMouseMove={onArenaMouseMove}>
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

      <div className="tactical-topbar">
        <div className="tactical-title">战术指挥</div>
        <div className={`tactical-pause-state${paused ? ' is-paused' : ''}`}>
          {paused ? '已暂停 ⏸' : '运行中 ▶'}
        </div>
        <button
          className="tactical-btn"
          onClick={() => { playUi('ui.tactical.toggle-pause'); useCombatStore.getState().togglePause() }}
        >
          {paused ? '继续 (空格)' : '暂停 (空格)'}
        </button>
      </div>

      <PlayerHud title={playerCls.nameZh} snap={player} />
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

      <div className="tactical-hint">
        WASD 操控旗舰 · 按住 Shift 让船头追随鼠标 · 武器在敌舰进入射程与射界时自动开火 · 空格切换暂停 · Tab 查看战斗日志
      </div>
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
