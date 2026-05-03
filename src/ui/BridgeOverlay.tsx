// Phase 6.0 Slice G — bridge-mode combat overlay. Active-pause UI: schematic
// player ship + enemy ship, reactor allocator, weapon queue, hull/shields HUD,
// spacebar pause toggle.
//
// We don't use koota's useTrait/useQuery here because those bind to the
// active-scene WorldProvider — and the player may be in city when combat
// starts. Instead we poll the ship world via a 30Hz interval; combat traits
// only mutate at frame rate so this is fine.

import { useEffect, useState } from 'react'
import { useCombatStore, getPlayerShieldLayers, getPlayerShieldCap, setMountTarget } from '../systems/combat'
import { getWorld } from '../ecs/world'
import { Ship, ShipSystemState, WeaponMount, EnemyShipState } from '../ecs/traits'
import { getShipClass, type ShipRoomDef } from '../data/ships'
import { getWeapon } from '../data/weapons'
import { SHIP_SYSTEMS, type SystemId, type ShipSystemDef } from '../data/shipSystems'
import { setSystemPower } from '../sim/ship'

const SHIP_SCENE_ID = 'playerShipInterior'

interface PlayerSnap {
  hullCurrent: number
  hullMax: number
  reactorMax: number
  reactorAllocated: number
  classId: string
  systems: { systemId: SystemId; level: number; powerAlloc: number; integrityPct: number }[]
  mounts: {
    mountIdx: number
    weaponId: string
    chargeSec: number
    ready: boolean
    targetEnemyRoomId: string | null
  }[]
  shieldLayers: number
  shieldCap: number
}

interface EnemySnap {
  shipClassId: string
  hullCurrent: number
  hullMax: number
  shields: { layers: number; layersMax: number; rechargeSec: number }
  rooms: { roomId: string; nameZh: string; system: SystemId | null; integrityPct: number }[]
  weapons: { weaponId: string; chargeSec: number; ready: boolean }[]
}

function snapshotPlayer(): PlayerSnap | null {
  const w = getWorld(SHIP_SCENE_ID)
  const shipEnt = w.queryFirst(Ship)
  if (!shipEnt) return null
  const s = shipEnt.get(Ship)!
  const systems: PlayerSnap['systems'] = []
  for (const e of w.query(ShipSystemState)) {
    const ss = e.get(ShipSystemState)!
    systems.push({
      systemId: ss.systemId,
      level: ss.level,
      powerAlloc: ss.powerAlloc,
      integrityPct: ss.integrityPct,
    })
  }
  const mounts: PlayerSnap['mounts'] = []
  for (const e of w.query(WeaponMount)) {
    const m = e.get(WeaponMount)!
    mounts.push({
      mountIdx: m.mountIdx,
      weaponId: m.weaponId,
      chargeSec: m.chargeSec,
      ready: m.ready,
      targetEnemyRoomId: m.targetEnemyRoomId,
    })
  }
  mounts.sort((a, b) => a.mountIdx - b.mountIdx)
  return {
    hullCurrent: s.hullCurrent,
    hullMax: s.hullMax,
    reactorMax: s.reactorMax,
    reactorAllocated: s.reactorAllocated,
    classId: s.classId,
    systems,
    mounts,
    shieldLayers: getPlayerShieldLayers(),
    shieldCap: getPlayerShieldCap(),
  }
}

function snapshotEnemy(): EnemySnap | null {
  const w = getWorld(SHIP_SCENE_ID)
  const e = w.queryFirst(EnemyShipState)
  if (!e) return null
  const s = e.get(EnemyShipState)!
  return {
    shipClassId: s.shipClassId,
    hullCurrent: s.hullCurrent,
    hullMax: s.hullMax,
    shields: { ...s.shields },
    rooms: s.rooms.map((r) => ({ ...r })),
    weapons: s.weapons.map((w) => ({ ...w })),
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

function IntegrityBar(props: { pct: number }) {
  const p = Math.max(0, Math.min(1, props.pct))
  const color = p > 0.5 ? 'var(--accent)' : p > 0 ? 'var(--warn)' : 'var(--danger)'
  return (
    <div className="bridge-integrity-bar">
      <div
        className="bridge-integrity-fill"
        style={{ width: `${p * 100}%`, background: color }}
      />
    </div>
  )
}

function PlayerShipPanel(props: {
  snap: PlayerSnap
  selectedSystem: SystemId | null
  onSelectSystem: (sys: SystemId | null) => void
}) {
  const { snap, selectedSystem, onSelectSystem } = props
  const cls = getShipClass(snap.classId)
  const sysById: Map<SystemId, PlayerSnap['systems'][number]> = new Map()
  for (const s of snap.systems) sysById.set(s.systemId, s)

  const cellSize = 56
  const gap = 4
  const maxX = Math.max(...cls.rooms.map((r) => r.bounds.x + r.bounds.w))
  const maxY = Math.max(...cls.rooms.map((r) => r.bounds.y + r.bounds.h))
  const width = maxX * (cellSize + gap)
  const height = maxY * (cellSize + gap)

  return (
    <div className="bridge-ship">
      <div className="bridge-ship-title">玩家飞船</div>
      <div
        className="bridge-room-grid"
        style={{ width, height, position: 'relative' }}
      >
        {cls.rooms.map((r: ShipRoomDef) => {
          const sys = r.system ? sysById.get(r.system) : null
          const isSelected = r.system && r.system === selectedSystem
          return (
            <div
              key={r.id}
              className={`bridge-room${isSelected ? ' is-selected' : ''}`}
              style={{
                left: r.bounds.x * (cellSize + gap),
                top: r.bounds.y * (cellSize + gap),
                width: r.bounds.w * cellSize + (r.bounds.w - 1) * gap,
                height: r.bounds.h * cellSize + (r.bounds.h - 1) * gap,
                cursor: r.system ? 'pointer' : 'default',
              }}
              onClick={() => {
                if (!r.system) return
                onSelectSystem(selectedSystem === r.system ? null : r.system)
              }}
            >
              <div className="bridge-room-name">{r.nameZh}</div>
              {sys && (
                <>
                  <div className="bridge-room-stat">
                    L{sys.level} · {sys.powerAlloc}电
                  </div>
                  <IntegrityBar pct={sys.integrityPct} />
                </>
              )}
            </div>
          )
        })}
      </div>
      <div className="bridge-hull">
        装甲 {snap.hullCurrent}/{snap.hullMax}
      </div>
      <div className="bridge-shields">
        护盾 {Array.from({ length: snap.shieldCap }).map((_, i) => (
          <span key={i} className={`bridge-shield-dot${i < snap.shieldLayers ? ' is-on' : ''}`} />
        ))}
        {snap.shieldCap === 0 && <span className="bridge-muted">无护盾</span>}
      </div>
    </div>
  )
}

function EnemyShipPanel(props: {
  snap: EnemySnap
  onTargetRoom: (roomId: string) => void
}) {
  const { snap, onTargetRoom } = props
  return (
    <div className="bridge-ship">
      <div className="bridge-ship-title">{snap.shipClassId === 'pirateLight' ? '海盗轻型护卫舰' : snap.shipClassId}</div>
      <div className="bridge-enemy-rooms">
        {snap.rooms.map((r) => (
          <div
            key={r.roomId}
            className="bridge-room is-enemy"
            onClick={() => onTargetRoom(r.roomId)}
          >
            <div className="bridge-room-name">{r.nameZh}</div>
            {r.system && (
              <div className="bridge-room-stat">{SHIP_SYSTEMS[r.system].nameZh}</div>
            )}
            <IntegrityBar pct={r.integrityPct} />
          </div>
        ))}
      </div>
      <div className="bridge-hull">
        装甲 {snap.hullCurrent}/{snap.hullMax}
      </div>
      <div className="bridge-shields">
        护盾 {Array.from({ length: snap.shields.layersMax }).map((_, i) => (
          <span key={i} className={`bridge-shield-dot${i < snap.shields.layers ? ' is-on' : ''}`} />
        ))}
      </div>
    </div>
  )
}

function ReactorBar(props: { snap: PlayerSnap }) {
  const { snap } = props
  const free = snap.reactorMax - snap.reactorAllocated
  const slots: ('used' | 'free')[] = []
  for (let i = 0; i < snap.reactorAllocated; i++) slots.push('used')
  for (let i = 0; i < free; i++) slots.push('free')

  const adjust = (sysId: SystemId, delta: number) => {
    const s = snap.systems.find((x) => x.systemId === sysId)
    if (!s) return
    setSystemPower(sysId, s.powerAlloc + delta)
  }

  return (
    <div className="bridge-reactor">
      <div className="bridge-reactor-row">
        <span className="bridge-reactor-label">反应堆</span>
        <div className="bridge-reactor-bar">
          {slots.map((kind, i) => (
            <span
              key={i}
              className={`bridge-reactor-cell${kind === 'used' ? ' is-used' : ''}`}
            />
          ))}
        </div>
        <span className="bridge-reactor-count">
          {snap.reactorAllocated}/{snap.reactorMax}
        </span>
      </div>
      <div className="bridge-power-row">
        {snap.systems.map((s) => {
          const def: ShipSystemDef = SHIP_SYSTEMS[s.systemId]
          return (
            <div key={s.systemId} className="bridge-power-cell">
              <div className="bridge-power-name">{def.nameZh}</div>
              <div className="bridge-power-controls">
                <button
                  className="bridge-power-btn"
                  onClick={() => adjust(s.systemId, -1)}
                  disabled={s.powerAlloc <= 0}
                >−</button>
                <span className="bridge-power-value">{s.powerAlloc}</span>
                <button
                  className="bridge-power-btn"
                  onClick={() => adjust(s.systemId, +1)}
                  disabled={free <= 0 || s.powerAlloc >= def.maxLevel}
                >+</button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function WeaponQueue(props: {
  snap: PlayerSnap
  selectedMountIdx: number | null
  onSelect: (idx: number | null) => void
}) {
  const { snap, selectedMountIdx, onSelect } = props
  return (
    <div className="bridge-weapons">
      <div className="bridge-section-title">武器队列</div>
      {snap.mounts.map((m) => {
        if (!m.weaponId) {
          return (
            <div key={m.mountIdx} className="bridge-weapon-row is-empty">
              <span className="bridge-muted">挂载位 {m.mountIdx + 1} · 空</span>
            </div>
          )
        }
        const def = getWeapon(m.weaponId)
        const pct = def.chargeSec > 0 ? m.chargeSec / def.chargeSec : 0
        const isSelected = selectedMountIdx === m.mountIdx
        return (
          <div
            key={m.mountIdx}
            className={`bridge-weapon-row${isSelected ? ' is-selected' : ''}`}
            onClick={() => onSelect(isSelected ? null : m.mountIdx)}
          >
            <div className="bridge-weapon-name">
              ▶ {def.nameZh}
              {m.ready && <span className="bridge-weapon-ready"> · 就绪</span>}
            </div>
            <ChargeBar pct={pct} ready={m.ready} />
            <div className="bridge-weapon-target">
              目标:{m.targetEnemyRoomId ?? '—'}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function BridgeOverlay() {
  const open = useCombatStore((s) => s.open)
  const paused = useCombatStore((s) => s.paused)
  const selectedMountIdx = useCombatStore((s) => s.selectedMountIdx)
  const lastFlashZh = useCombatStore((s) => s.lastFlashZh)
  const lastFlashAtMs = useCombatStore((s) => s.lastFlashAtMs)
  const [selectedSystem, setSelectedSystem] = useState<SystemId | null>(null)
  // Tick to force re-snapshot. The combat tick mutates traits at frame rate;
  // we poll at ~30Hz which is fine for UI feedback.
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
      // Only intercept space when the overlay is open. Avoid swallowing if
      // focus is in a text input (defensive — none today, but cheap).
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

  // Flash banner — show recent flash for ~1.5s after it lands.
  const flashAge = performance.now() - lastFlashAtMs
  const showFlash = lastFlashZh && flashAge < 1500

  const onTargetRoom = (roomId: string) => {
    let mountIdx = selectedMountIdx
    if (mountIdx === null) {
      // Default to the first ready weapon, otherwise the first non-empty.
      const ready = player.mounts.find((m) => m.weaponId && m.ready)
      const any = player.mounts.find((m) => m.weaponId)
      mountIdx = ready?.mountIdx ?? any?.mountIdx ?? null
    }
    if (mountIdx === null) return
    setMountTarget(mountIdx, roomId)
    useCombatStore.getState().setSelectedMount(mountIdx)
  }

  return (
    <div className="bridge-overlay">
      <div className="bridge-panel">
        <header className="bridge-header">
          <h2>战斗指挥</h2>
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

        <ReactorBar snap={player} />

        <div className="bridge-ships">
          <PlayerShipPanel
            snap={player}
            selectedSystem={selectedSystem}
            onSelectSystem={setSelectedSystem}
          />
          <div className="bridge-vs">VS</div>
          <EnemyShipPanel snap={enemy} onTargetRoom={onTargetRoom} />
        </div>

        <WeaponQueue
          snap={player}
          selectedMountIdx={selectedMountIdx}
          onSelect={(idx) => useCombatStore.getState().setSelectedMount(idx)}
        />

        {showFlash && <div className="bridge-flash">{lastFlashZh}</div>}

        <div className="bridge-hint">
          点击玩家舱室分配电力 · 选中武器后点击敌方舱室设置目标 · 空格切换暂停
        </div>
      </div>
    </div>
  )
}
