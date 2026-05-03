import { useEffect, useRef, useState } from 'react'
import { Stage, Layer, Rect, Circle, Line, Text, Group, Ring } from 'react-konva'
import type Konva from 'konva'
import { getWorld } from '../ecs/world'
import {
  IsPlayer, Position, Body, PoiTag, Velocity, Course,
} from '../ecs/traits'
import { CELESTIAL_BODIES, type CelestialKind } from '../data/celestialBodies'
import { POIS, type Poi } from '../data/pois'
import { spaceConfig } from '../config'

const SPACE_SCENE_ID = 'spaceCampaign'

const BODY_COLOR: Record<CelestialKind, { fill: string; stroke: string }> = {
  star:     { fill: '#fde68a', stroke: '#fef9c3' },
  planet:   { fill: '#1e3a8a', stroke: '#93c5fd' },
  moon:     { fill: '#525252', stroke: '#a3a3a3' },
  colony:   { fill: '#14532d', stroke: '#4ade80' },
  asteroid: { fill: '#3f2d14', stroke: '#a16207' },
}

interface SnapshotEntity {
  id: number
  x: number
  y: number
}

interface BodySnapshot extends SnapshotEntity {
  bodyId: string
  nameZh: string
  radius: number
  kind: CelestialKind
}

interface PoiSnapshot extends SnapshotEntity {
  poi: Poi
}

interface ShipSnapshot {
  x: number
  y: number
  vx: number
  vy: number
  course: { tx: number; ty: number; destPoiId: string | null; active: boolean } | null
}

interface Snapshot {
  bodies: BodySnapshot[]
  pois: PoiSnapshot[]
  ship: ShipSnapshot | null
}

const bodyDataById = new Map(CELESTIAL_BODIES.map((b) => [b.id, b]))
const poiDataById = new Map(POIS.map((p) => [p.id, p]))

function snapshot(): Snapshot {
  const w = getWorld(SPACE_SCENE_ID)
  const bodies: BodySnapshot[] = []
  for (const e of w.query(Body, Position)) {
    const b = e.get(Body)!
    const p = e.get(Position)!
    const data = bodyDataById.get(b.bodyId)
    if (!data) continue
    bodies.push({
      id: 0,
      x: p.x,
      y: p.y,
      bodyId: b.bodyId,
      nameZh: data.nameZh,
      radius: data.bodyRadius,
      kind: data.kind,
    })
  }
  const pois: PoiSnapshot[] = []
  for (const e of w.query(PoiTag, Position)) {
    const t = e.get(PoiTag)!
    const p = e.get(Position)!
    const data = poiDataById.get(t.poiId)
    if (!data) continue
    pois.push({ id: 0, x: p.x, y: p.y, poi: data })
  }

  let ship: ShipSnapshot | null = null
  const playerEnt = w.queryFirst(IsPlayer, Position, Velocity)
  if (playerEnt) {
    const pp = playerEnt.get(Position)!
    const vv = playerEnt.get(Velocity)!
    const cc = playerEnt.get(Course) ?? null
    ship = {
      x: pp.x,
      y: pp.y,
      vx: vv.vx,
      vy: vv.vy,
      course: cc ? { tx: cc.tx, ty: cc.ty, destPoiId: cc.destPoiId, active: cc.active } : null,
    }
  }
  return { bodies, pois, ship }
}

function fitTransform(snap: Snapshot, viewW: number, viewH: number): { scale: number; cx: number; cy: number } {
  const points: { x: number; y: number; r: number }[] = []
  for (const b of snap.bodies) points.push({ x: b.x, y: b.y, r: b.radius })
  for (const p of snap.pois) points.push({ x: p.x, y: p.y, r: 8 })
  if (snap.ship) points.push({ x: snap.ship.x, y: snap.ship.y, r: 8 })

  if (points.length === 0) return { scale: 1, cx: 0, cy: 0 }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of points) {
    minX = Math.min(minX, p.x - p.r)
    minY = Math.min(minY, p.y - p.r)
    maxX = Math.max(maxX, p.x + p.r)
    maxY = Math.max(maxY, p.y + p.r)
  }
  const pad = spaceConfig.fitSystemPaddingPx
  const w = (maxX - minX) + pad * 2
  const h = (maxY - minY) + pad * 2
  const scale = Math.min(viewW / w, viewH / h, 1)
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  return { scale, cx, cy }
}

interface PanelState {
  poiId: string
}

export function SpaceView() {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight })
  const [tick, setTick] = useState(0)
  const [fitMode, setFitMode] = useState(false)
  const [panel, setPanel] = useState<PanelState | null>(null)
  const stageRef = useRef<Konva.Stage>(null)

  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Re-render every rAF tick — koota's per-frame derivedPos updates land
  // directly on the Position trait; we read inline below in render.
  useEffect(() => {
    let raf = 0
    const loop = () => {
      setTick((t) => (t + 1) | 0)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  // TAB toggles fit-system mode; ESC exits both fit mode and any open panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        e.preventDefault()
        setFitMode((m) => !m)
      } else if (e.key === 'Escape') {
        setFitMode(false)
        setPanel(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Touch `tick` so the linter does not flag it; the value itself is just a
  // re-render trigger, not a data input.
  void tick

  const snap = snapshot()
  const { w: viewW, h: viewH } = size

  // Camera: fit-mode scales and centers on the system bbox; otherwise we
  // follow the ship at scale 1.
  let scale = 1
  let cx = snap.ship?.x ?? 0
  let cy = snap.ship?.y ?? 0
  if (fitMode) {
    const ft = fitTransform(snap, viewW, viewH)
    scale = ft.scale
    cx = ft.cx
    cy = ft.cy
  }
  const offsetX = -cx * scale + viewW / 2
  const offsetY = -cy * scale + viewH / 2

  function worldFromScreen(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - offsetX) / scale, y: (sy - offsetY) / scale }
  }

  function findNearbyPoi(worldX: number, worldY: number): Poi | null {
    let best: Poi | null = null
    let bestD2 = spaceConfig.dockSnapRadius * spaceConfig.dockSnapRadius
    for (const ps of snap.pois) {
      const dx = ps.x - worldX
      const dy = ps.y - worldY
      const d2 = dx * dx + dy * dy
      if (d2 < bestD2) {
        bestD2 = d2
        best = ps.poi
      }
    }
    return best
  }

  function onStageClick(e: Konva.KonvaEventObject<MouseEvent>) {
    const stage = stageRef.current
    if (!stage) return
    const pos = stage.getPointerPosition()
    if (!pos) return
    const wp = worldFromScreen(pos.x, pos.y)

    // Right-click sets a Course; left-click queries the panel.
    const isRight = e.evt.button === 2
    if (isRight) {
      e.evt.preventDefault()
      const w = getWorld(SPACE_SCENE_ID)
      const player = w.queryFirst(IsPlayer, Course)
      if (!player) return
      const near = findNearbyPoi(wp.x, wp.y)
      if (near) {
        const ent = (() => {
          for (const pe of w.query(PoiTag, Position)) {
            if (pe.get(PoiTag)!.poiId === near.id) return pe
          }
          return null
        })()
        const targetPos = ent?.get(Position) ?? { x: wp.x, y: wp.y }
        player.set(Course, {
          tx: targetPos.x,
          ty: targetPos.y,
          destPoiId: near.id,
          active: true,
        })
      } else {
        player.set(Course, { tx: wp.x, ty: wp.y, destPoiId: null, active: true })
      }
    } else {
      const near = findNearbyPoi(wp.x, wp.y)
      if (near) setPanel({ poiId: near.id })
      else setPanel(null)
    }
  }

  function onStageContextMenu(e: Konva.KonvaEventObject<PointerEvent>) {
    e.evt.preventDefault()
  }

  // Course preview line endpoint — track the live POI position if dest set,
  // else use the static target.
  let coursePreview: { fromX: number; fromY: number; toX: number; toY: number } | null = null
  if (snap.ship && snap.ship.course?.active) {
    let tx = snap.ship.course.tx
    let ty = snap.ship.course.ty
    if (snap.ship.course.destPoiId) {
      const found = snap.pois.find((p) => p.poi.id === snap.ship!.course!.destPoiId)
      if (found) { tx = found.x; ty = found.y }
    }
    coursePreview = { fromX: snap.ship.x, fromY: snap.ship.y, toX: tx, toY: ty }
  }

  // Ship heading (pointing direction). Velocity preferred; fall back to up.
  let shipAngle = -Math.PI / 2
  if (snap.ship && (snap.ship.vx !== 0 || snap.ship.vy !== 0)) {
    shipAngle = Math.atan2(snap.ship.vy, snap.ship.vx)
  }

  const panelPoi = panel ? poiDataById.get(panel.poiId) ?? null : null

  return (
    <div
      className="space-view"
      style={{
        position: 'fixed',
        inset: 0,
        background: '#020617',
        zIndex: 5,
      }}
    >
      <Stage
        ref={stageRef}
        width={viewW}
        height={viewH}
        onClick={onStageClick}
        onContextMenu={onStageContextMenu}
      >
        <Layer x={offsetX} y={offsetY} scaleX={scale} scaleY={scale}>
          {/* Bodies */}
          {snap.bodies.map((b) => {
            const c = BODY_COLOR[b.kind]
            return (
              <Group key={`body-${b.bodyId}`}>
                <Circle x={b.x} y={b.y} radius={b.radius} fill={c.fill} stroke={c.stroke} strokeWidth={2 / scale} />
                <Text
                  x={b.x + b.radius + 6 / scale}
                  y={b.y - 8 / scale}
                  text={b.nameZh}
                  fontSize={14 / scale}
                  fill="#cbd5e1"
                />
              </Group>
            )
          })}
          {/* POIs */}
          {snap.pois.map((p) => {
            const isHovered = panel?.poiId === p.poi.id
            const r = 6
            return (
              <Group key={`poi-${p.poi.id}`}>
                <Rect
                  x={p.x - r}
                  y={p.y - r}
                  width={r * 2}
                  height={r * 2}
                  fill="#0ea5e9"
                  stroke="#bae6fd"
                  strokeWidth={1.5 / scale}
                />
                {isHovered && (
                  <Ring
                    x={p.x}
                    y={p.y}
                    innerRadius={spaceConfig.dockSnapRadius - 2}
                    outerRadius={spaceConfig.dockSnapRadius}
                    fill="#fde68a"
                    opacity={0.5}
                  />
                )}
                <Text
                  x={p.x - 40}
                  y={p.y + r + 4 / scale}
                  text={p.poi.shortZh ?? p.poi.nameZh}
                  fontSize={12 / scale}
                  width={80}
                  align="center"
                  fill="#e2e8f0"
                />
              </Group>
            )
          })}
          {/* Course preview */}
          {coursePreview && (
            <Line
              points={[coursePreview.fromX, coursePreview.fromY, coursePreview.toX, coursePreview.toY]}
              stroke="#facc15"
              strokeWidth={2 / scale}
              dash={[8 / scale, 8 / scale]}
            />
          )}
          {/* Player ship */}
          {snap.ship && (
            <Group x={snap.ship.x} y={snap.ship.y} rotation={(shipAngle * 180) / Math.PI}>
              <Line
                points={[12, 0, -8, -7, -8, 7]}
                closed
                fill="#facc15"
                stroke="#fef3c7"
                strokeWidth={1 / scale}
              />
            </Group>
          )}
        </Layer>
      </Stage>
      {panelPoi && (
        <div
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            width: 280,
            background: 'rgba(15, 23, 42, 0.92)',
            border: '1px solid #334155',
            color: '#e2e8f0',
            padding: '12px 14px',
            fontFamily: 'system-ui, sans-serif',
            fontSize: 13,
            borderRadius: 4,
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>{panelPoi.nameZh}</div>
          <div style={{ color: '#94a3b8', marginBottom: 4 }}>类型: {panelPoi.type}</div>
          <div style={{ color: '#94a3b8', marginBottom: 4 }}>母星: {bodyDataById.get(panelPoi.bodyId)?.nameZh ?? panelPoi.bodyId}</div>
          <div style={{ color: '#94a3b8', marginBottom: 4 }}>势力: {panelPoi.factionControlPre}</div>
          <div style={{ color: '#94a3b8', marginBottom: 6 }}>服务: {panelPoi.services.join(', ') || '无'}</div>
          {panelPoi.description && (
            <div style={{ color: '#cbd5e1', marginTop: 8, lineHeight: 1.5 }}>{panelPoi.description}</div>
          )}
          <div style={{ marginTop: 10, fontSize: 11, color: '#64748b' }}>
            右键空间 = 设置航向 · TAB = 缩放至全景 · ESC = 关闭
          </div>
        </div>
      )}
    </div>
  )
}
