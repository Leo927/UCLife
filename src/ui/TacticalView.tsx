// Phase 6.0 Starsector-shape tactical combat overlay. Top-down 2D
// real-time-with-pause view: player flagship, enemy ship(s), projectiles,
// HUD strips for hull/armor/flux/shields, weapon-charge bars, click-to-
// move steering for the flagship. Spacebar toggles pause.
//
// We don't use koota's useTrait/useQuery here because those bind to the
// active-scene WorldProvider — and the player may be in city when combat
// starts. Instead we poll the ship world via a 30Hz interval; combat
// traits only mutate at frame rate so this is fine.

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

function ChargeBar(props: { pct: number; ready: boolean }) {
  return (
    <div className="bridge-charge-bar">
      <div
        className={`bridge-charge-fill${props.ready ? ' is-ready' : ''}`}
        style={{ width: `${Math.max(0, Math.min(100, props.pct * 100))}%` }}
      />
    </div>
  )
}

function StatBar(props: { label: string; current: number; max: number; color: string }) {
  const pct = props.max > 0 ? Math.max(0, Math.min(100, (props.current / props.max) * 100)) : 0
  return (
    <div className="bridge-integrity-bar" style={{ position: 'relative' }}>
      <div
        className="bridge-integrity-fill"
        style={{ width: `${pct}%`, background: props.color }}
      />
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 8px', fontSize: 11, color: '#e6e6ea',
      }}>
        <span>{props.label}</span>
        <span>{Math.round(props.current)} / {props.max}</span>
      </div>
    </div>
  )
}

function ShipHud(props: { side: 'left' | 'right'; title: string; snap: PlayerSnap | EnemySnap }) {
  const { side, title, snap } = props
  return (
    <div className={`bridge-ship bridge-ship-${side}`}>
      <div className="bridge-ship-title">{title}</div>
      <StatBar label="船体" current={snap.hullCurrent} max={snap.hullMax} color="var(--accent)" />
      <StatBar label="装甲" current={snap.armorCurrent} max={snap.armorMax} color="#a3a3a3" />
      <StatBar label="电荷" current={snap.fluxCurrent} max={snap.fluxMax} color="#3b82f6" />
    </div>
  )
}

function playerVisual(p: PlayerSnap): PixiShipSnap {
  // Shield alpha falls off as flux saturates so the player can read
  // shield headroom from the ring fade.
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

  const rendererRef = useRef<PixiTacticalRenderer | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

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
      canvasRef.current = null
    }
  }, [open])

  if (!open) return null
  void tick

  const player = snapshotPlayer()
  const enemy = snapshotEnemy()
  if (!player || !enemy) return null

  const flashAge = performance.now() - lastFlashAtMs
  const showFlash = lastFlashZh && flashAge < 1500

  // Click on the arena: set the player's move target. Pause-friendly —
  // queues a destination that the combat tick steers toward. Coords are
  // converted via the canvas's getBoundingClientRect so CSS scaling works
  // as it did with the SVG.
  const onArenaClick = (ev: React.MouseEvent<HTMLDivElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    const x = ((ev.clientX - rect.left) / rect.width) * ARENA_W
    const y = ((ev.clientY - rect.top) / rect.height) * ARENA_H
    useCombatStore.getState().setPlayerTarget({ x, y })
  }

  const onPixiReady = (app: Application) => {
    rendererRef.current = new PixiTacticalRenderer(app, ARENA_W, ARENA_H)
    canvasRef.current = app.canvas as HTMLCanvasElement
  }

  const playerCls = getShipClass(player.classId)

  return (
    <div className="bridge-overlay">
      <div className="bridge-panel">
        <header className="bridge-header">
          <h2>战术指挥</h2>
          <div className={`bridge-pause-state${paused ? ' is-paused' : ''}`}>
            {paused ? '已暂停 ⏸' : '运行中 ▶'}
          </div>
          <button
            className="bridge-pause-btn"
            onClick={() => useCombatStore.getState().togglePause()}
          >
            {paused ? '继续 (空格)' : '暂停 (空格)'}
          </button>
        </header>

        <div className="bridge-ships">
          <ShipHud side="left" title={playerCls.nameZh} snap={player} />
          <div className="bridge-vs">VS</div>
          <ShipHud side="right" title={enemy.nameZh} snap={enemy} />
        </div>

        {/* Tactical arena — top-down 2D Pixi view. Click sets player target.
            Canvas drawing buffer is native arena size (1000×600); the host
            div CSS-fits the 360-tall container while preserving aspect ratio
            (letterbox-equivalent of the previous SVG preserveAspectRatio). */}
        <div
          className="tactical-arena"
          onClick={onArenaClick}
          style={{
            width: '100%', height: 360,
            background: '#070710', border: '1px solid #2a2a30',
            cursor: 'crosshair', overflow: 'hidden',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <PixiCanvas
            width={ARENA_W}
            height={ARENA_H}
            background={0x070710}
            hostStyle={{
              height: '100%',
              aspectRatio: `${ARENA_W} / ${ARENA_H}`,
              maxWidth: '100%',
            }}
            onReady={onPixiReady}
          />
        </div>

        {/* Weapon charge queue — shows readiness per mount. Auto-fires when
            target is in arc and range, so the queue is informational rather
            than the primary input. Player's main verb is positioning. */}
        <div className="bridge-weapons">
          <div className="bridge-section-title">武器队列</div>
          {player.mounts.map((m) => {
            if (!m.weaponId) {
              return (
                <div key={m.mountIdx} className="bridge-weapon-row is-empty">
                  <span className="bridge-muted">挂载位 {m.mountIdx + 1} · 空</span>
                </div>
              )
            }
            const def = getWeapon(m.weaponId)
            const pct = def.chargeSec > 0 ? m.chargeSec / def.chargeSec : 0
            return (
              <div key={m.mountIdx} className="bridge-weapon-row">
                <div className="bridge-weapon-name">
                  {def.nameZh}
                  {m.ready && <span className="bridge-weapon-ready"> · 就绪</span>}
                </div>
                <ChargeBar pct={pct} ready={m.ready} />
              </div>
            )
          })}
        </div>

        {showFlash && <div className="bridge-flash">{lastFlashZh}</div>}

        <div className="bridge-hint">
          点击战场为旗舰下达航向 · 武器在敌方进入射程时自动开火 · 空格切换暂停
        </div>
      </div>
    </div>
  )
}
