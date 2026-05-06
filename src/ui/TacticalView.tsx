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
import { getWorld } from '../ecs/world'
import { Ship, WeaponMount, EnemyShipState } from '../ecs/traits'
import { getShipClass } from '../data/ships'
import { getWeapon } from '../data/weapons'
import { PixiCanvas } from '../render/pixi'
import {
  PixiTacticalRenderer,
  type ShipSnap as PixiShipSnap,
  type BeamFlashVisual,
} from '../render/space/PixiTacticalRenderer'

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
  mounts: { mountIdx: number; weaponId: string; chargeSec: number; ready: boolean }[]
}

interface EnemySnap {
  shipClassId: string
  nameZh: string
  pos: { x: number; y: number }
  heading: number
  hullCurrent: number; hullMax: number
  armorCurrent: number; armorMax: number
  fluxCurrent: number; fluxMax: number
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
    mounts,
  }
}

function snapshotEnemy(): EnemySnap | null {
  const w = getWorld(SHIP_SCENE_ID)
  const e = w.queryFirst(EnemyShipState)
  if (!e) return null
  const s = e.get(EnemyShipState)!
  return {
    shipClassId: s.shipClassId,
    nameZh: s.nameZh,
    pos: { x: s.pos.x, y: s.pos.y },
    heading: s.heading,
    hullCurrent: s.hullCurrent, hullMax: s.hullMax,
    armorCurrent: s.armorCurrent, armorMax: s.armorMax,
    fluxCurrent: s.fluxCurrent, fluxMax: s.fluxMax,
    shieldUp: s.shieldUp,
  }
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
        <span className={`tactical-shield-pip${snap.shieldUp ? ' is-up' : ''}`}>
          {snap.shieldUp ? '护盾·开' : '护盾·关'}
        </span>
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
    shieldAlpha: 0.15 + 0.55 * Math.max(0, shieldHeadroom),
  }
}

function enemyVisual(e: EnemySnap): PixiShipSnap {
  const shieldHeadroom = e.fluxMax > 0 ? 1 - e.fluxCurrent / e.fluxMax : 0
  return {
    x: e.pos.x, y: e.pos.y,
    heading: e.heading,
    hullRadius: 16,
    shieldRadius: 28,
    color: 0xdc2626,
    shieldAlpha: e.shieldUp ? 0.15 + 0.55 * Math.max(0, shieldHeadroom) : 0,
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
          const e = snapshotEnemy()
          const projectiles = useCombatStore.getState().getProjectiles()
          r.update({
            arenaW: ARENA_W, arenaH: ARENA_H,
            player: p ? playerVisual(p) : null,
            enemy: e ? enemyVisual(e) : null,
            projectiles: projectiles.map((pj) => ({
              id: pj.id, x: pj.x, y: pj.y, ownerSide: pj.ownerSide,
            })),
            beams: beamVisuals(),
            playerTarget: useCombatStore.getState().playerTarget,
          })
        }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return
      }
      if (ev.code === 'Space') {
        ev.preventDefault()
        useCombatStore.getState().togglePause()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
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
  const enemy = snapshotEnemy()
  if (!player || !enemy) return null

  const flashAge = performance.now() - lastFlashAtMs
  const showFlash = lastFlashZh && flashAge < 1500

  // Click on the arena: convert screen coords to arena world coords via
  // the renderer's viewport transform.
  const onArenaClick = (ev: React.MouseEvent<HTMLDivElement>) => {
    const r = rendererRef.current
    if (!r) return
    const rect = ev.currentTarget.getBoundingClientRect()
    const sx = ev.clientX - rect.left
    const sy = ev.clientY - rect.top
    const wp = r.screenToWorld(sx, sy)
    useCombatStore.getState().setPlayerTarget({ x: wp.x, y: wp.y })
  }

  const onPixiReady = (app: Application) => {
    const sz = sizeRef.current
    rendererRef.current = new PixiTacticalRenderer(app, sz.w, sz.h, ARENA_W, ARENA_H)
  }

  const playerCls = getShipClass(player.classId)

  return (
    <div className="tactical-overlay">
      <div className="tactical-canvas-host" onClick={onArenaClick}>
        <PixiCanvas
          width={size.w}
          height={size.h}
          background={0x070710}
          hostStyle={{ width: '100%', height: '100%' }}
          onReady={onPixiReady}
        />
      </div>

      <div className="tactical-topbar">
        <div className="tactical-title">战术指挥</div>
        <div className={`tactical-pause-state${paused ? ' is-paused' : ''}`}>
          {paused ? '已暂停 ⏸' : '运行中 ▶'}
        </div>
        <button
          className="tactical-btn"
          onClick={() => useCombatStore.getState().togglePause()}
        >
          {paused ? '继续 (空格)' : '暂停 (空格)'}
        </button>
      </div>

      <PlayerHud title={playerCls.nameZh} snap={player} />
      <EnemyHud title={enemy.nameZh} snap={enemy} />

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
        点击战场为旗舰下达航向 · 武器在敌方进入射程时自动开火 · 空格切换暂停
      </div>
    </div>
  )
}
