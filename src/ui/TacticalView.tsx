// Phase 6.0 Starsector-shape tactical combat overlay. Top-down 2D
// real-time-with-pause view: player flagship, enemy ship(s), projectiles,
// HUD strips for hull/armor/flux/shields, weapon-charge bars, click-to-
// move steering for the flagship. Spacebar toggles pause.
//
// We don't use koota's useTrait/useQuery here because those bind to the
// active-scene WorldProvider — and the player may be in city when combat
// starts. Instead we poll the ship world via a 30Hz interval; combat
// traits only mutate at frame rate so this is fine.

import { useEffect, useState } from 'react'
import {
  useCombatStore, ARENA_W, ARENA_H,
} from '../systems/combat'
import { getWorld } from '../ecs/world'
import { Ship, WeaponMount, EnemyShipState } from '../ecs/traits'
import { getShipClass } from '../data/ships'
import { getWeapon } from '../data/weapons'

const SHIP_SCENE_ID = 'playerShipInterior'

interface PlayerSnap {
  classId: string
  pos: { x: number; y: number }
  hullCurrent: number; hullMax: number
  armorCurrent: number; armorMax: number
  fluxCurrent: number; fluxMax: number
  topSpeed: number
  mounts: { mountIdx: number; weaponId: string; chargeSec: number; ready: boolean }[]
}

interface EnemySnap {
  shipClassId: string
  nameZh: string
  pos: { x: number; y: number }
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
    pos: { x: s.fleetPos.x, y: s.fleetPos.y },
    hullCurrent: s.hullCurrent, hullMax: s.hullMax,
    armorCurrent: s.armorCurrent, armorMax: s.armorMax,
    fluxCurrent: s.fluxCurrent, fluxMax: s.fluxMax,
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

export function TacticalView() {
  const open = useCombatStore((s) => s.open)
  const paused = useCombatStore((s) => s.paused)
  const lastFlashZh = useCombatStore((s) => s.lastFlashZh)
  const lastFlashAtMs = useCombatStore((s) => s.lastFlashAtMs)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!open) return
    let raf = 0
    let last = 0
    const loop = (now: number) => {
      if (now - last >= 33) {
        last = now
        setTick((t) => (t + 1) & 0xffff)
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

  if (!open) return null
  void tick

  const player = snapshotPlayer()
  const enemy = snapshotEnemy()
  if (!player || !enemy) return null

  const flashAge = performance.now() - lastFlashAtMs
  const showFlash = lastFlashZh && flashAge < 1500

  const projectiles = useCombatStore.getState().getProjectiles()

  // Click on the arena: set the player's move target. Pause-friendly —
  // queues a destination that the combat tick steers toward.
  const onArenaClick = (ev: React.MouseEvent<SVGSVGElement>) => {
    const svg = ev.currentTarget
    const rect = svg.getBoundingClientRect()
    const x = ((ev.clientX - rect.left) / rect.width) * ARENA_W
    const y = ((ev.clientY - rect.top) / rect.height) * ARENA_H
    useCombatStore.getState().setPlayerTarget({ x, y })
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

        {/* Tactical arena — top-down 2D view. Click to set player target. */}
        <div className="tactical-arena">
          <svg
            viewBox={`0 0 ${ARENA_W} ${ARENA_H}`}
            preserveAspectRatio="xMidYMid meet"
            onClick={onArenaClick}
            style={{ width: '100%', height: 360, background: '#070710', border: '1px solid #2a2a30', cursor: 'crosshair' }}
          >
            {/* Arena edges + grid */}
            <rect x={0} y={0} width={ARENA_W} height={ARENA_H} fill="none" stroke="#1f1f25" strokeWidth={2} />

            {/* Player ship */}
            <g>
              <circle
                cx={player.pos.x}
                cy={player.pos.y}
                r={32}
                fill="none"
                stroke="#4ade80"
                strokeWidth={2}
                opacity={player.fluxCurrent < player.fluxMax ? 0.7 : 0.15}
              />
              <circle cx={player.pos.x} cy={player.pos.y} r={14} fill="#4ade80" />
            </g>

            {/* Enemy ship */}
            <g>
              <circle
                cx={enemy.pos.x}
                cy={enemy.pos.y}
                r={28}
                fill="none"
                stroke="#dc2626"
                strokeWidth={2}
                opacity={enemy.shieldUp ? 0.7 : 0.15}
              />
              <circle cx={enemy.pos.x} cy={enemy.pos.y} r={12} fill="#dc2626" />
            </g>

            {/* Projectiles */}
            {projectiles.map((p) => (
              <circle
                key={p.id}
                cx={p.x}
                cy={p.y}
                r={3}
                fill={p.ownerSide === 'player' ? '#4ade80' : '#f97316'}
              />
            ))}
          </svg>
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
