import { useEffect, useRef, useState } from 'react'
import { Stage, Layer, Rect, Circle, Line, Text, Group } from 'react-konva'
import type Konva from 'konva'
import { useQuery, useQueryFirst, useTrait } from 'koota/react'
import {
  Position, IsPlayer, Interactable, MoveTarget, QueuedInteract, Action,
  Vitals, Health, Building, Character, Bed, BarSeat, RoughSpot, Job, Workstation, Wall, Door, ChatLine,
  Active, Road,
  type InteractableKind, type RoadKind,
} from '../ecs/traits'
import { useCamera } from './cameraStore'
import type { BedTier } from '../ecs/traits'
import { BED_MULTIPLIERS, bedActiveOccupant } from '../systems/bed'
import { startLoop, stopLoop } from '../sim/loop'
import { setupWorld } from '../ecs/spawn'
import { actionLabel } from '../data/actions'
import { getJobSpec } from '../data/jobs'
import { MapWarnings } from '../ui/MapWarnings'
import { useUI } from '../ui/uiStore'
import { useClock } from '../sim/clock'
import type { Entity } from 'koota'

import { worldConfig } from '../config'
import { getActiveSceneDimensions } from '../ecs/world'
import { CharacterSprite } from './sprite/CharacterSprite'
import { startAnimTicker } from './sprite/animTick'

const TILE = worldConfig.tilePx

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))

export function Game() {
  // Game remounts on scene swap (App is keyed by activeId), so a static
  // read here is correct — no useScene subscription needed.
  const { tilesX: COLS, tilesY: ROWS } = getActiveSceneDimensions()
  const W = COLS * TILE
  const H = ROWS * TILE

  const wrapRef = useRef<HTMLDivElement>(null)
  const [canvas, setCanvas] = useState({ w: W, h: H })

  useEffect(() => {
    setupWorld()
    startLoop()
    startAnimTicker()
    return () => stopLoop()
  }, [])

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const update = () => {
      const r = wrap.getBoundingClientRect()
      setCanvas({
        w: Math.min(Math.floor(r.width), W),
        h: Math.min(Math.floor(r.height), H),
      })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [])

  const allInteractables = useQuery(Interactable, Position)
  const allBuildings = useQuery(Building)
  const allBeds = useQuery(Bed, Position)
  const allBarSeats = useQuery(BarSeat, Position)
  const allWalls = useQuery(Wall)
  const allDoors = useQuery(Door)
  const allRoads = useQuery(Road)
  const npcs = useQuery(Active, Character, Position)
  const player = useQueryFirst(IsPlayer, Position)
  const playerPos = useTrait(player, Position)
  const playerAction = useTrait(player, Action)
  const moveTarget = useTrait(player, MoveTarget)
  const playerVitals = useTrait(player, Vitals)
  const playerHealth = useTrait(player, Health)

  const worstVital = playerVitals && playerHealth
    ? Math.max(playerVitals.hunger, playerVitals.thirst, playerVitals.fatigue, 100 - playerHealth.hp)
    : 0
  const ringStroke = worstVital >= 90 ? '#ef4444'
    : worstVital >= 75 ? '#f97316'
    : worstVital >= 50 ? '#facc15'
    : '#22c55e'

  const camX = playerPos ? clamp(playerPos.x - canvas.w / 2, 0, Math.max(0, W - canvas.w)) : 0
  const camY = playerPos ? clamp(playerPos.y - canvas.h / 2, 0, Math.max(0, H - canvas.h)) : 0

  const RENDER_PAD_PX = 2 * TILE
  const vx0 = camX - RENDER_PAD_PX
  const vy0 = camY - RENDER_PAD_PX
  const vx1 = camX + canvas.w + RENDER_PAD_PX
  const vy1 = camY + canvas.h + RENDER_PAD_PX
  const rectInView = (x: number, y: number, w: number, h: number): boolean =>
    x + w >= vx0 && x <= vx1 && y + h >= vy0 && y <= vy1
  const ptInView = (x: number, y: number): boolean =>
    x >= vx0 && x <= vx1 && y >= vy0 && y <= vy1

  const walls = allWalls.filter((e) => {
    const t = e.get(Wall)
    return t ? rectInView(t.x, t.y, t.w, t.h) : false
  })
  const roads = allRoads.filter((e) => {
    const t = e.get(Road)
    return t ? rectInView(t.x, t.y, t.w, t.h) : false
  })
  const doors = allDoors.filter((e) => {
    const t = e.get(Door)
    return t ? rectInView(t.x, t.y, t.w, t.h) : false
  })
  const buildings = allBuildings.filter((e) => {
    const t = e.get(Building)
    return t ? rectInView(t.x, t.y, t.w, t.h) : false
  })
  const beds = allBeds.filter((e) => {
    const p = e.get(Position)
    return p ? ptInView(p.x, p.y) : false
  })
  const barSeats = allBarSeats.filter((e) => {
    const p = e.get(Position)
    return p ? ptInView(p.x, p.y) : false
  })
  const interactables = allInteractables.filter((e) => {
    const p = e.get(Position)
    return p ? ptInView(p.x, p.y) : false
  })

  const gridColStart = Math.max(0, Math.floor(vx0 / TILE))
  const gridColEnd = Math.min(COLS, Math.ceil(vx1 / TILE))
  const gridRowStart = Math.max(0, Math.floor(vy0 / TILE))
  const gridRowEnd = Math.min(ROWS, Math.ceil(vy1 / TILE))

  // Mirror viewport into the camera store for activeZoneSystem. Effect-based
  // to avoid a side-effect during render; the store coalesces no-op writes.
  useEffect(() => {
    useCamera.getState().setCamera({ canvasW: canvas.w, canvasH: canvas.h, camX, camY })
  }, [canvas.w, canvas.h, camX, camY])

  const onPointerDown = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    const stage = e.target.getStage()
    const p = stage?.getPointerPosition()
    if (!p) return
    if (!player) return
    const isWorking = playerAction?.kind === 'working'
    if (
      playerAction &&
      playerAction.kind !== 'idle' &&
      playerAction.kind !== 'walking' &&
      !isWorking
    ) {
      return
    }

    const lx = p.x + camX
    const ly = p.y + camY

    // Click priority: a living NPC under the click wins over the workstation
    // below them, so clerks can be talked to. Ties broken by nearest center.
    let bestNpc: Entity | null = null
    let bestNpcDist = Infinity
    for (const npcEnt of npcs) {
      const np = npcEnt.get(Position)
      if (!np) continue
      const d = Math.hypot(lx - np.x, ly - np.y)
      if (d > 14 || d >= bestNpcDist) continue
      const npcHealth = npcEnt.get(Health)
      if (npcHealth?.dead) continue
      bestNpc = npcEnt
      bestNpcDist = d
    }
    if (bestNpc) {
      useUI.getState().setDialogNPC(bestNpc)
      return
    }

    if (isWorking) {
      // Click on the workstation = ignore (don't restart). Off-station = leave job.
      let onWorkstation = false
      for (const ent of interactables) {
        const ipos = ent.get(Position)
        const it = ent.get(Interactable)
        if (!ipos || !it) continue
        if (it.kind !== 'work') continue
        if (Math.hypot(lx - ipos.x, ly - ipos.y) <= 22) {
          onWorkstation = true
          break
        }
      }
      if (onWorkstation) return
      player.set(Action, { kind: 'idle', remaining: 0, total: 0 })
    }

    let clickedInteractable = false
    for (const ent of interactables) {
      const ipos = ent.get(Position)
      if (!ipos) continue
      const d = Math.hypot(lx - ipos.x, ly - ipos.y)
      if (d <= 28) {
        player.set(MoveTarget, { x: ipos.x, y: ipos.y })
        if (!player.has(QueuedInteract)) player.add(QueuedInteract)
        clickedInteractable = true
        break
      }
    }
    if (!clickedInteractable) {
      const x = clamp(lx, 0, W)
      const y = clamp(ly, 0, H)
      player.set(MoveTarget, { x, y })
      if (player.has(QueuedInteract)) player.remove(QueuedInteract)
    }
  }

  return (
    <div className="game-wrap" ref={wrapRef}>
      <div className="game-stage" style={{ width: canvas.w, height: canvas.h }}>
      <Stage
        width={canvas.w}
        height={canvas.h}
        onMouseDown={onPointerDown}
        onTouchStart={onPointerDown}
        className="game-canvas"
      >
        <Layer listening={false} x={-camX} y={-camY}>
          <Rect x={0} y={0} width={W} height={H} fill="#0a0a0d" />
          {Array.from({
            length: Math.max(0, gridRowEnd - gridRowStart + 1),
          }).map((_, i) => {
            const r = gridRowStart + i
            return (
              <Line
                key={`h${r}`}
                points={[0, r * TILE, W, r * TILE]}
                stroke="#1c1c22"
                strokeWidth={1}
              />
            )
          })}
          {Array.from({
            length: Math.max(0, gridColEnd - gridColStart + 1),
          }).map((_, i) => {
            const c = gridColStart + i
            return (
              <Line
                key={`v${c}`}
                points={[c * TILE, 0, c * TILE, H]}
                stroke="#1c1c22"
                strokeWidth={1}
              />
            )
          })}
          {roads.map((r) => <RoadMark key={r} entity={r} />)}
          {buildings.map((b) => <BuildingMark key={b} entity={b} />)}
          {walls.map((w) => <WallMark key={w} entity={w} />)}
          {doors.map((d) => <DoorMark key={d} entity={d} />)}
        </Layer>
        <Layer listening={false} x={-camX} y={-camY}>
          {beds.map((ent) => (
            <BedMark key={ent} entity={ent} />
          ))}
          {barSeats.map((ent) => (
            <BarSeatMark key={ent} entity={ent} />
          ))}
          {interactables.map((ent) => (
            <InteractableMark key={ent} entity={ent} />
          ))}
          {npcs.map((ent) => (
            <NPCMark key={ent} entity={ent} />
          ))}
          {moveTarget && playerPos && Math.hypot(moveTarget.x - playerPos.x, moveTarget.y - playerPos.y) > 2 && (
            <Circle
              x={moveTarget.x}
              y={moveTarget.y}
              radius={5}
              stroke="#ffaa00"
              strokeWidth={1}
              opacity={0.7}
            />
          )}
          {playerPos && player && (
            <Group>
              <Circle
                x={playerPos.x}
                y={playerPos.y}
                radius={11}
                stroke={ringStroke}
                strokeWidth={worstVital >= 75 ? 3 : 2}
                opacity={0.85}
              />
              <CharacterSprite entity={player} />
              {playerAction && playerAction.kind !== 'idle' && playerAction.kind !== 'walking' && (
                <Text
                  x={playerPos.x - 30}
                  y={playerPos.y - 56}
                  width={60}
                  align="center"
                  text={actionLabel(playerAction.kind)}
                  fontSize={11}
                  fill="#ffaa00"
                  fontFamily='"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif'
                />
              )}
            </Group>
          )}
        </Layer>
      </Stage>
        <MapWarnings />
      </div>
    </div>
  )
}

const COLORS: Record<InteractableKind, { fill: string; stroke: string }> = {
  eat: { fill: '#7c2d12', stroke: '#ea580c' },
  sleep: { fill: '#1e3a8a', stroke: '#3b82f6' },
  wash: { fill: '#155e75', stroke: '#06b6d4' },
  work: { fill: '#3b1e7a', stroke: '#a855f7' },
  shop: { fill: '#854d0e', stroke: '#facc15' },
  hr: { fill: '#831843', stroke: '#ec4899' },
  bar: { fill: '#7f1d1d', stroke: '#ef4444' },
  manager: { fill: '#3f3f46', stroke: '#a1a1aa' },
  aeReception: { fill: '#7c5614', stroke: '#c9a047' },
  gym: { fill: '#3a2c0a', stroke: '#c9a047' },
  tap: { fill: '#1e293b', stroke: '#64748b' },
  scavenge: { fill: '#3a2e1a', stroke: '#a3a3a3' },
  rough: { fill: '#262626', stroke: '#737373' },
  transit: { fill: '#134e4a', stroke: '#2dd4bf' },
  ticketCounter: { fill: '#1e3a8a', stroke: '#60a5fa' },
}

function NPCMark({ entity }: { entity: Entity }) {
  const pos = useTrait(entity, Position)
  const info = useTrait(entity, Character)
  const action = useTrait(entity, Action)
  const vitals = useTrait(entity, Vitals)
  const health = useTrait(entity, Health)
  const job = useTrait(entity, Job)
  const chatLine = useTrait(entity, ChatLine)
  const gameDate = useClock((s) => s.gameDate)
  if (!pos || !info) return null
  const isDead = !!health?.dead
  const kind = action?.kind ?? 'idle'
  const isVisible = !isDead && kind !== 'idle' && kind !== 'walking'
  const showSpeech = !isDead && kind === 'chatting' && !!chatLine?.text

  // Working title comes from the current Workstation's spec, not the
  // character's static profile.
  const wsTrait = job?.workstation?.get(Workstation)
  const wsSpec = wsTrait ? getJobSpec(wsTrait.specId) : null
  const workTitle = wsSpec?.jobTitle ?? info.title

  let label = ''
  if (isVisible) {
    label = kind === 'working' && workTitle ? workTitle : actionLabel(kind)
  }

  let progress = -1
  if (vitals) {
    if (kind === 'eating') progress = 1 - vitals.hunger / 100
    else if (kind === 'drinking') progress = 1 - vitals.thirst / 100
    else if (kind === 'sleeping') progress = 1 - vitals.fatigue / 100
    else if (kind === 'washing') progress = 1 - vitals.hygiene / 100
  }
  if (kind === 'working') {
    if (wsSpec) {
      const minute = gameDate.getHours() * 60 + gameDate.getMinutes()
      const ws = wsSpec.shiftStart * 60
      const we = wsSpec.shiftEnd * 60
      const span = we - ws
      progress = span > 0 ? Math.max(0, Math.min(1, (minute - ws) / span)) : -1
    }
  }
  progress = Math.max(-1, Math.min(1, progress))

  const barW = 28
  const barH = 3

  // Speech bubble dimensions estimated at ~10px per CJK glyph since Konva
  // doesn't easily expose rendered text width before mount.
  const SPEECH_FONT = 11
  const SPEECH_MAX_W = 180
  const SPEECH_PAD_X = 6
  const SPEECH_PAD_Y = 3
  const speechText = chatLine?.text ?? ''
  const speechWidth = Math.min(SPEECH_MAX_W, speechText.length * (SPEECH_FONT - 1) + SPEECH_PAD_X * 2)
  const speechHeight = SPEECH_FONT + SPEECH_PAD_Y * 2

  return (
    <Group opacity={isDead ? 0.45 : 1}>
      {showSpeech && (
        <Group>
          <Rect
            x={pos.x - speechWidth / 2}
            y={pos.y - 44}
            width={speechWidth}
            height={speechHeight}
            fill="#fefce8"
            stroke="#facc15"
            strokeWidth={1}
            cornerRadius={4}
          />
          <Text
            x={pos.x - speechWidth / 2 + SPEECH_PAD_X}
            y={pos.y - 44 + SPEECH_PAD_Y}
            width={speechWidth - SPEECH_PAD_X * 2}
            align="center"
            text={speechText}
            fontSize={SPEECH_FONT}
            fill="#0d0d10"
            fontFamily='"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif'
            ellipsis
          />
        </Group>
      )}
      {isVisible && (
        <Group>
          <Text
            x={pos.x - 40}
            y={pos.y - 28}
            width={80}
            align="center"
            text={label}
            fontSize={9}
            fill="#facc15"
            fontFamily='"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif'
          />
          {progress >= 0 && (
            <>
              <Rect
                x={pos.x - barW / 2}
                y={pos.y - 16}
                width={barW}
                height={barH}
                fill="#0a0a0d"
                stroke="#3a3a44"
                strokeWidth={1}
              />
              <Rect
                x={pos.x - barW / 2}
                y={pos.y - 16}
                width={barW * progress}
                height={barH}
                fill="#facc15"
              />
            </>
          )}
        </Group>
      )}
      {isDead ? (
        <Group>
          <Circle
            x={pos.x}
            y={pos.y}
            radius={9}
            fill="#3f3f46"
            stroke="#ef4444"
            strokeWidth={2}
            opacity={0.95}
          />
          <Text
            x={pos.x - 6}
            y={pos.y - 7}
            text="✕"
            fontSize={14}
            fontStyle="bold"
            fill="#ef4444"
          />
        </Group>
      ) : (
        <CharacterSprite entity={entity} />
      )}
      <Text
        x={pos.x - 40}
        y={pos.y + 14}
        width={80}
        align="center"
        text={isDead ? `${info.name} · 已故` : info.name}
        fontSize={10}
        fill={isDead ? '#ef4444' : '#bdbdc6'}
        fontFamily='"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif'
      />
    </Group>
  )
}

const BED_VISUAL: Record<BedTier, { fill: string; stroke: string; w: number; h: number; label: string }> = {
  luxury:    { fill: '#0e2a3a', stroke: '#22d3ee', w: 28, h: 18, label: '高级床' },
  apartment: { fill: '#1e3a8a', stroke: '#60a5fa', w: 26, h: 16, label: '床' },
  dorm:      { fill: '#3a2e1a', stroke: '#a78b4a', w: 22, h: 14, label: '宿舍床' },
  lounge:    { fill: '#3a2c0a', stroke: '#c9a047', w: 26, h: 14, label: '员工沙发' },
  flop:      { fill: '#262626', stroke: '#737373', w: 20, h: 14, label: '投币床' },
}

function BedMark({ entity }: { entity: Entity }) {
  const pos = useTrait(entity, Position)
  const bed = useTrait(entity, Bed)
  const it = useTrait(entity, Interactable)
  const player = useQueryFirst(IsPlayer)
  // Subscribe to gameDate so the "已租 / available" flip happens promptly
  // when a rent window expires.
  const gameMs = useClock((s) => s.gameDate.getTime())
  if (!pos || !bed) return null
  const v = BED_VISUAL[bed.tier as BedTier]
  if (!v) return null
  // bedActiveOccupant honours unexpired rent — a flop bed whose 12-hour
  // window has lapsed reads as available before rentSystem clears occupant.
  const active = bedActiveOccupant(bed, gameMs)
  const occupied = active !== null
  const isPlayerBed = active !== null && active === player
  const labelText = it?.label ?? v.label
  const mult = BED_MULTIPLIERS[bed.tier as BedTier] ?? 1.0
  const showFee = !occupied && it && it.fee > 0
  const bodyOpacity = occupied ? 0.3 : 1
  const overlayStroke = isPlayerBed ? '#4ade80' : occupied ? '#ef4444' : v.stroke
  return (
    <Group>
      <Rect
        x={pos.x - v.w / 2}
        y={pos.y - v.h / 2}
        width={v.w}
        height={v.h}
        fill={v.fill}
        stroke={overlayStroke}
        strokeWidth={2}
        cornerRadius={3}
        opacity={bodyOpacity}
      />
      <Rect
        x={pos.x - v.w / 2 + 2}
        y={pos.y - v.h / 2 + 2}
        width={v.w - 4}
        height={4}
        fill={v.stroke}
        opacity={occupied ? 0.25 : 0.7}
        cornerRadius={2}
      />
      {occupied && !isPlayerBed && (
        <Line
          points={[
            pos.x - v.w / 2,
            pos.y + v.h / 2,
            pos.x + v.w / 2,
            pos.y - v.h / 2,
          ]}
          stroke="#ef4444"
          strokeWidth={2}
          opacity={0.85}
        />
      )}
      {mult !== 1.0 && !occupied && (
        <Text
          x={pos.x - v.w / 2}
          y={pos.y - v.h / 2 - 11}
          width={v.w}
          align="center"
          text={`×${mult.toFixed(2)}`}
          fontSize={9}
          fill={v.stroke}
          fontStyle="bold"
        />
      )}
      {showFee && (
        <Group>
          <Rect
            x={pos.x + v.w / 2 - 4}
            y={pos.y - v.h / 2 - 12}
            width={28}
            height={12}
            fill="#facc15"
            cornerRadius={3}
          />
          <Text
            x={pos.x + v.w / 2 - 4}
            y={pos.y - v.h / 2 - 11}
            width={28}
            align="center"
            text={`¥${it.fee}`}
            fontSize={9}
            fontStyle="bold"
            fill="#0d0d10"
          />
        </Group>
      )}
      {occupied && (
        <Group>
          <Rect
            x={pos.x - v.w / 2}
            y={pos.y - v.h / 2 - 12}
            width={isPlayerBed ? 28 : 24}
            height={12}
            fill={isPlayerBed ? '#166534' : '#7f1d1d'}
            cornerRadius={3}
          />
          <Text
            x={pos.x - v.w / 2}
            y={pos.y - v.h / 2 - 11}
            width={isPlayerBed ? 28 : 24}
            align="center"
            text={bed.owned && isPlayerBed ? '已购' : isPlayerBed ? '你的' : '已租'}
            fontSize={9}
            fontStyle="bold"
            fill="#fef2f2"
            fontFamily='"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif'
          />
        </Group>
      )}
      <Text
        x={pos.x - 36}
        y={pos.y + v.h / 2 + 4}
        width={72}
        align="center"
        text={labelText}
        fontSize={11}
        fill={occupied ? '#71717a' : '#bdbdc6'}
        fontFamily='"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif'
      />
    </Group>
  )
}

function BarSeatMark({ entity }: { entity: Entity }) {
  const pos = useTrait(entity, Position)
  const seat = useTrait(entity, BarSeat)
  const it = useTrait(entity, Interactable)
  if (!pos || !seat) return null
  const occupied = seat.occupant !== null
  const fill = '#7f1d1d'
  const stroke = '#ef4444'
  const w = 18
  const h = 14
  return (
    <Group opacity={occupied ? 0.4 : 1}>
      <Rect
        x={pos.x - w / 2}
        y={pos.y - h / 2}
        width={w}
        height={h}
        fill={fill}
        stroke={stroke}
        strokeWidth={2}
        cornerRadius={2}
      />
      <Rect
        x={pos.x - w / 2}
        y={pos.y - h / 2}
        width={w}
        height={3}
        fill={stroke}
        cornerRadius={1}
      />
      {it && it.fee > 0 && !occupied && (
        <Group>
          <Rect
            x={pos.x + w / 2 - 4}
            y={pos.y - h / 2 - 11}
            width={26}
            height={11}
            fill="#facc15"
            cornerRadius={3}
          />
          <Text
            x={pos.x + w / 2 - 4}
            y={pos.y - h / 2 - 10}
            width={26}
            align="center"
            text={`¥${it.fee}`}
            fontSize={9}
            fontStyle="bold"
            fill="#0d0d10"
          />
        </Group>
      )}
    </Group>
  )
}

const ROAD_FILL: Record<RoadKind, string> = {
  avenue: '#2a2a32',
  street: '#33333d',
  alley:  '#3d3d47',
}

function RoadMark({ entity }: { entity: Entity }) {
  const r = useTrait(entity, Road)
  if (!r) return null
  return (
    <Rect
      x={r.x}
      y={r.y}
      width={r.w}
      height={r.h}
      fill={ROAD_FILL[r.kind as RoadKind]}
    />
  )
}

function WallMark({ entity }: { entity: Entity }) {
  const w = useTrait(entity, Wall)
  if (!w) return null
  return (
    <Rect
      x={w.x}
      y={w.y}
      width={w.w}
      height={w.h}
      fill="#3f3f46"
      stroke="#52525b"
      strokeWidth={1}
    />
  )
}

function DoorMark({ entity }: { entity: Entity }) {
  const d = useTrait(entity, Door)
  if (!d) return null
  // Three bands: faction-gated (AE gold), bed-keyed (amber), unlocked (gray).
  let fill = '#1f1f24'
  let stroke = '#71717a'
  if (d.factionGate !== null) {
    fill = '#3a2c0a'
    stroke = '#c9a047'
  } else if (d.bedEntity !== null) {
    fill = '#3a2206'
    stroke = '#fbbf24'
  }
  return (
    <Group>
      <Rect
        x={d.x}
        y={d.y}
        width={d.w}
        height={d.h}
        fill={fill}
        stroke={stroke}
        strokeWidth={1}
        dash={[3, 2]}
      />
    </Group>
  )
}

function BuildingMark({ entity }: { entity: Entity }) {
  const b = useTrait(entity, Building)
  if (!b) return null
  return (
    <Group>
      <Rect
        x={b.x}
        y={b.y}
        width={b.w}
        height={b.h}
        fill="rgba(50, 50, 60, 0.18)"
        stroke="#2f2f3a"
        strokeWidth={1}
        dash={[6, 4]}
        cornerRadius={6}
      />
      <Text
        x={b.x + 8}
        y={b.y + 6}
        text={b.label}
        fontSize={11}
        fill="#5a5a64"
        fontFamily='"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif'
      />
    </Group>
  )
}

const ROUGH_HAZARD_TEXT: Record<'tap' | 'scavenge' | 'rough', string> = {
  tap: '⚠ 不卫生',
  scavenge: '⚠ 馊腐',
  rough: '⚠ 风餐',
}

function InteractableMark({ entity }: { entity: Entity }) {
  const pos = useTrait(entity, Position)
  const it = useTrait(entity, Interactable)
  const npcInfo = useTrait(entity, Character)
  const bed = useTrait(entity, Bed)
  const barSeat = useTrait(entity, BarSeat)
  const roughSpot = useTrait(entity, RoughSpot)
  if (!pos || !it) return null
  if (npcInfo) return null
  if (bed) return null
  if (barSeat) return null
  const c = COLORS[it.kind]
  const isRough = it.kind === 'tap' || it.kind === 'scavenge' || it.kind === 'rough'
  const benchOccupied = !!roughSpot && roughSpot.occupant !== null
  const labelWithFee = it.fee > 0 ? `${it.label} · ¥${it.fee}` : it.label
  return (
    <Group opacity={benchOccupied ? 0.45 : 1}>
      <Rect
        x={pos.x - 14}
        y={pos.y - 14}
        width={28}
        height={28}
        fill={c.fill}
        stroke={isRough ? '#facc15' : c.stroke}
        strokeWidth={isRough ? 2 : 2}
        dash={isRough ? [4, 3] : undefined}
        cornerRadius={4}
      />
      {it.fee > 0 && (
        <Group>
          <Rect
            x={pos.x + 4}
            y={pos.y - 22}
            width={32}
            height={14}
            fill="#facc15"
            cornerRadius={3}
          />
          <Text
            x={pos.x + 4}
            y={pos.y - 21}
            width={32}
            align="center"
            text={`¥${it.fee}`}
            fontSize={10}
            fontStyle="bold"
            fill="#0d0d10"
          />
        </Group>
      )}
      {isRough && (
        <Group>
          <Rect
            x={pos.x - 22}
            y={pos.y - 24}
            width={22}
            height={12}
            fill="#22c55e"
            cornerRadius={3}
          />
          <Text
            x={pos.x - 22}
            y={pos.y - 23}
            width={22}
            align="center"
            text="免费"
            fontSize={9}
            fontStyle="bold"
            fill="#0d0d10"
            fontFamily='"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif'
          />
          <Rect
            x={pos.x + 2}
            y={pos.y - 24}
            width={36}
            height={12}
            fill="#facc15"
            cornerRadius={3}
          />
          <Text
            x={pos.x + 2}
            y={pos.y - 23}
            width={36}
            align="center"
            text={ROUGH_HAZARD_TEXT[it.kind as 'tap' | 'scavenge' | 'rough']}
            fontSize={9}
            fontStyle="bold"
            fill="#0d0d10"
            fontFamily='"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif'
          />
        </Group>
      )}
      <Text
        x={pos.x - 36}
        y={pos.y + 18}
        width={72}
        align="center"
        text={benchOccupied ? `${labelWithFee} · 占用中` : labelWithFee}
        fontSize={12}
        fill="#cccccc"
        fontFamily='"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif'
      />
    </Group>
  )
}
