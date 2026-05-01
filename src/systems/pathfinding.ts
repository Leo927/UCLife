// Half-tile (16px) sub-grid A*. Doors aren't walls; a door with bedEntity
// set is a cell door blocked for everyone except the bed's current renter.
// Buffers are sized to MAX dimensions across scenes so cell-index math
// (y*COLS+x) stays constant.

import type { Entity, World } from 'koota'
import { Wall, Door, Bed, PendingEviction } from '../ecs/traits'
import { useClock } from '../sim/clock'
import { worldConfig } from '../config'
import { maxSceneTilesX, maxSceneTilesY } from '../data/scenes'
import { getActiveSceneId, type SceneId } from '../ecs/world'
import { isAffiliated } from './factionAccess'
import { hpaFind, markHpaDirty } from './hpa'

const TILE = worldConfig.tilePx
const SUB = 2 // 2 sub-cells per tile = 16px cells
const COLS = maxSceneTilesX * SUB
const ROWS = maxSceneTilesY * SUB
const CELL = TILE / SUB

export const PF_COLS = COLS
export const PF_ROWS = ROWS
export const PF_CELL = CELL

// 4-connectivity for components matches A*'s no-corner-cutting. Wall-only
// — locked doors are NOT in components, so per-requester door overlays
// (which only add blocks) preserve same-component reachability soundness.
interface SceneCache {
  wallGrid: Uint8Array | null
  wallsDirty: boolean
  componentGrid: Uint16Array | null
  componentsDirty: boolean
}
const sceneCaches = new Map<SceneId, SceneCache>()

function getSceneCache(id: SceneId): SceneCache {
  let c = sceneCaches.get(id)
  if (!c) {
    c = { wallGrid: null, wallsDirty: true, componentGrid: null, componentsDirty: true }
    sceneCaches.set(id, c)
  }
  return c
}

let blocked: Uint8Array | null = null
let _blockedScratch: Uint8Array | null = null

// Also flags HPA dirty since its cluster graph reads the same wall layer.
export function markPathfindingDirty(sceneId?: SceneId) {
  const id = sceneId ?? getActiveSceneId()
  const sc = getSceneCache(id)
  sc.wallsDirty = true
  sc.componentsDirty = true
  markHpaDirty(id)
}

function blockRect(g: Uint8Array, x: number, y: number, w: number, h: number) {
  const x0 = Math.max(0, Math.floor(x / CELL))
  const x1 = Math.min(COLS - 1, Math.floor((x + w - 1) / CELL))
  const y0 = Math.max(0, Math.floor(y / CELL))
  const y1 = Math.min(ROWS - 1, Math.floor((y + h - 1) / CELL))
  for (let y2 = y0; y2 <= y1; y2++) {
    for (let x2 = x0; x2 <= x1; x2++) {
      g[y2 * COLS + x2] = 1
    }
  }
}

function rebuildWalls(world: World, sc: SceneCache): void {
  const g = sc.wallGrid ?? new Uint8Array(COLS * ROWS)
  // Reuse the existing buffer to avoid churning ~1.7 MB per procgen pass.
  if (sc.wallGrid) g.fill(0)
  for (const e of world.query(Wall)) {
    const w = e.get(Wall)!
    // No padding: any pad would seal the 1-cell gap doors rely on.
    blockRect(g, w.x, w.y, w.w, w.h)
  }
  sc.wallGrid = g
  sc.wallsDirty = false
  sc.componentsDirty = true
}

function rebuildComponents(sc: SceneCache): void {
  if (!sc.wallGrid) throw new Error('rebuildComponents: wallGrid not initialized')
  const wallGrid = sc.wallGrid
  const N = wallGrid.length
  const c = sc.componentGrid && sc.componentGrid.length === N ? sc.componentGrid : new Uint16Array(N)
  if (sc.componentGrid === c) c.fill(0)
  let nextId = 0
  // DFS flood fill, 4-connected. Pre-allocated stack avoids GC churn.
  const stack: number[] = []
  for (let i = 0; i < N; i++) {
    if (wallGrid[i] === 1 || c[i] !== 0) continue
    nextId++
    if (nextId > 65535) {
      // >65k free regions: collapse remainder into last id. Same-id checks
      // remain a correct upper bound but lose fast-fail for spillover.
      nextId = 65535
    }
    c[i] = nextId
    stack.length = 0
    stack.push(i)
    while (stack.length > 0) {
      const cur = stack.pop()!
      const cx = cur % COLS
      if (cx > 0)        { const nb = cur - 1;    if (wallGrid[nb] === 0 && c[nb] === 0) { c[nb] = nextId; stack.push(nb) } }
      if (cx < COLS - 1) { const nb = cur + 1;    if (wallGrid[nb] === 0 && c[nb] === 0) { c[nb] = nextId; stack.push(nb) } }
      if (cur >= COLS)         { const nb = cur - COLS; if (wallGrid[nb] === 0 && c[nb] === 0) { c[nb] = nextId; stack.push(nb) } }
      if (cur < N - COLS)      { const nb = cur + COLS; if (wallGrid[nb] === 0 && c[nb] === 0) { c[nb] = nextId; stack.push(nb) } }
    }
  }
  sc.componentGrid = c
  sc.componentsDirty = false
}

function getActiveCacheRebuilt(world: World): SceneCache {
  const sc = getSceneCache(getActiveSceneId())
  if (sc.wallsDirty || !sc.wallGrid) rebuildWalls(world, sc)
  if (sc.componentsDirty || !sc.componentGrid) rebuildComponents(sc)
  return sc
}

// 0 = wall/out-of-bounds; >0 = connected free-cell region. hpaFind uses
// this to fast-fail unreachable pairs before abstract A* exhaust.
export function getComponentOf(world: World, idx: number): number {
  const sc = getActiveCacheRebuilt(world)
  return sc.componentGrid![idx]
}

function setBlockedFor(world: World, requester: Entity | null): void {
  const sc = getSceneCache(getActiveSceneId())
  if (sc.wallsDirty || !sc.wallGrid) rebuildWalls(world, sc)
  const wallGrid = sc.wallGrid!
  if (!_blockedScratch || _blockedScratch.length !== wallGrid.length) {
    _blockedScratch = new Uint8Array(wallGrid.length)
  }
  const g = _blockedScratch
  g.set(wallGrid)
  const nowMs = useClock.getState().gameDate.getTime()
  // Eviction pass granted by rent.ts so the evictee can walk out.
  const pass = requester !== null ? requester.get(PendingEviction) : null
  const passActive = !!pass && pass.bedEntity !== null && pass.expireMs > nowMs
  for (const doorEnt of world.query(Door)) {
    const d = doorEnt.get(Door)!
    if (!d.bedEntity && !d.factionGate) continue

    if (d.bedEntity) {
      const bed = d.bedEntity.get(Bed)
      if (bed) {
        const tenant = bed.occupant
        const rentActive = tenant !== null && bed.rentPaidUntilMs > nowMs
        const requesterIsTenant = rentActive && requester !== null && tenant === requester
        if (requesterIsTenant) continue
        if (passActive && pass!.bedEntity === d.bedEntity) continue
      }
    }

    if (d.factionGate && requester !== null && isAffiliated(requester, d.factionGate)) {
      continue
    }

    blockRect(g, d.x, d.y, d.w, d.h)
  }
  blocked = g
}

function isBlocked(x: number, y: number): boolean {
  if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return true
  return blocked![y * COLS + x] === 1
}

// HPA wants the wall-only layer (no per-requester door overlay).
export function getWallGrid(world: World): Uint8Array {
  const sc = getSceneCache(getActiveSceneId())
  if (sc.wallsDirty || !sc.wallGrid) rebuildWalls(world, sc)
  return sc.wallGrid!
}

// hpa.ts reads this during refinement to detect cached intra paths that
// cross a locked door for the current requester.
export function getDoorBlockedGrid(): Uint8Array {
  return blocked!
}

// If the cell is blocked, BFS outward — lets endpoints inside a wall
// (e.g. a clicked door tile) still produce a usable path.
function snapToFree(px: number, py: number): { x: number; y: number } {
  const cx = Math.max(0, Math.min(COLS - 1, Math.floor(px / CELL)))
  const cy = Math.max(0, Math.min(ROWS - 1, Math.floor(py / CELL)))
  if (!isBlocked(cx, cy)) return { x: cx, y: cy }
  for (let r = 1; r <= 6; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue
        const nx = cx + dx, ny = cy + dy
        if (!isBlocked(nx, ny)) return { x: nx, y: ny }
      }
    }
  }
  return { x: cx, y: cy }
}

function cellCenter(cx: number, cy: number): { x: number; y: number } {
  return { x: cx * CELL + CELL / 2, y: cy * CELL + CELL / 2 }
}

// Octile heuristic, 8-connected, no corner-cutting.
const NEIGHBORS: [number, number, number][] = [
  [ 1, 0, 10], [-1, 0, 10], [0,  1, 10], [0, -1, 10],
  [ 1, 1, 14], [ 1,-1, 14], [-1, 1, 14], [-1,-1, 14],
]

// Generation counter (_gen[i] === _curGen iff cell visited this run) means
// no per-call clear is needed.
const _N = COLS * ROWS
const _gScore = new Float32Array(_N)
const _came = new Int32Array(_N)
const _closed = new Uint8Array(_N)
const _gen = new Int32Array(_N)
let _curGen = 0

// Stale entries (cell re-pushed at lower f) co-exist; filtered on pop via
// _closed and _gScore checks. Sized 2× grid to absorb.
const _heapIdx = new Int32Array(_N * 2)
const _heapF = new Float32Array(_N * 2)
let _heapSize = 0

function heapPush(idx: number, f: number): void {
  let i = _heapSize++
  _heapIdx[i] = idx
  _heapF[i] = f
  while (i > 0) {
    const parent = (i - 1) >> 1
    if (_heapF[parent] <= _heapF[i]) break
    const ti = _heapIdx[i]; _heapIdx[i] = _heapIdx[parent]; _heapIdx[parent] = ti
    const tf = _heapF[i];   _heapF[i]   = _heapF[parent];   _heapF[parent]   = tf
    i = parent
  }
}

function heapPop(): number {
  const top = _heapIdx[0]
  _heapSize--
  if (_heapSize > 0) {
    _heapIdx[0] = _heapIdx[_heapSize]
    _heapF[0] = _heapF[_heapSize]
    let i = 0
    for (;;) {
      const l = i * 2 + 1
      const r = l + 1
      let smallest = i
      if (l < _heapSize && _heapF[l] < _heapF[smallest]) smallest = l
      if (r < _heapSize && _heapF[r] < _heapF[smallest]) smallest = r
      if (smallest === i) break
      const ti = _heapIdx[i]; _heapIdx[i] = _heapIdx[smallest]; _heapIdx[smallest] = ti
      const tf = _heapF[i];   _heapF[i]   = _heapF[smallest];   _heapF[smallest]   = tf
      i = smallest
    }
  }
  return top
}

function touchCell(i: number): void {
  if (_gen[i] === _curGen) return
  _gen[i] = _curGen
  _gScore[i] = Infinity
  _came[i] = -1
  _closed[i] = 0
}

// Returns sub-cell indices including both endpoints, or null if unreachable.
// Empty array on sIdx === tIdx. Shared by flat findPath (full-map bounds)
// and HPA build/refinement (cluster-bounded).
export function aStarOnIdx(
  grid: Uint8Array,
  sIdx: number, tIdx: number,
  minX: number, minY: number, maxX: number, maxY: number,
): number[] | null {
  if (sIdx === tIdx) return []
  const sX = sIdx % COLS, sY = (sIdx / COLS) | 0
  const tX = tIdx % COLS, tY = (tIdx / COLS) | 0
  if (sX < minX || sX > maxX || sY < minY || sY > maxY) return null
  if (tX < minX || tX > maxX || tY < minY || tY > maxY) return null
  if (grid[sIdx] === 1 || grid[tIdx] === 1) return null

  _curGen++
  _heapSize = 0

  touchCell(sIdx)
  _gScore[sIdx] = 0
  heapPush(sIdx, 0)

  while (_heapSize > 0) {
    const idx = heapPop()
    if (idx === tIdx) {
      let len = 0
      let cur = idx
      while (cur !== -1) { len++; cur = _came[cur] }
      const out = new Array<number>(len)
      cur = idx
      for (let i = len - 1; i >= 0; i--) {
        out[i] = cur
        cur = _came[cur]
      }
      return out
    }
    if (_closed[idx]) continue
    _closed[idx] = 1
    const cx = idx % COLS
    const cy = (idx / COLS) | 0
    for (let n = 0; n < NEIGHBORS.length; n++) {
      const dx = NEIGHBORS[n][0]
      const dy = NEIGHBORS[n][1]
      const cost = NEIGHBORS[n][2]
      const nx = cx + dx, ny = cy + dy
      if (nx < minX || nx > maxX || ny < minY || ny > maxY) continue
      const nIdx = ny * COLS + nx
      if (grid[nIdx] === 1) continue
      // Diagonal needs both orthogonal neighbors clear.
      if (dx !== 0 && dy !== 0) {
        if (grid[cy * COLS + (cx + dx)] === 1) continue
        if (grid[(cy + dy) * COLS + cx] === 1) continue
      }
      touchCell(nIdx)
      if (_closed[nIdx]) continue
      const g = _gScore[idx] + cost
      if (g >= _gScore[nIdx]) continue
      _gScore[nIdx] = g
      _came[nIdx] = idx
      const ddx = Math.abs(nx - tX), ddy = Math.abs(ny - tY)
      const h = 10 * (ddx + ddy) + (14 - 20) * Math.min(ddx, ddy)
      heapPush(nIdx, g + h)
    }
  }
  return null
}

// String-pull LOS smoothing — drops waypoints whose removal still leaves
// a clear straight-line path.
function los(ax: number, ay: number, bx: number, by: number): boolean {
  const dx = bx - ax, dy = by - ay
  const dist = Math.hypot(dx, dy)
  const steps = Math.max(1, Math.ceil(dist / 4))
  for (let i = 1; i < steps; i++) {
    const t = i / steps
    const x = ax + dx * t
    const y = ay + dy * t
    const cx = Math.floor(x / CELL)
    const cy = Math.floor(y / CELL)
    if (isBlocked(cx, cy)) return false
  }
  return true
}

function smooth(path: { x: number; y: number }[]): { x: number; y: number }[] {
  if (path.length <= 2) return path
  const out: { x: number; y: number }[] = [path[0]]
  let i = 0
  while (i < path.length - 1) {
    let j = path.length - 1
    while (j > i + 1 && !los(path[i].x, path[i].y, path[j].x, path[j].y)) j--
    out.push(path[j])
    i = j
  }
  return out
}

// Returns pixel-space waypoints excluding the start. Pass `requester=null`
// for raw geometric pathing in tests (skips locked-door checks).
export function findPath(
  world: World,
  requester: Entity | null,
  from: { x: number; y: number },
  to: { x: number; y: number },
): { x: number; y: number }[] {
  setBlockedFor(world, requester)
  if (los(from.x, from.y, to.x, to.y)) return [{ x: to.x, y: to.y }]
  const s = snapToFree(from.x, from.y)
  const t = snapToFree(to.x, to.y)
  const idxPath = hpaFind(world, s.y * COLS + s.x, t.y * COLS + t.x)
  if (!idxPath || idxPath.length === 0) return []
  const grid: { x: number; y: number }[] = new Array(idxPath.length)
  for (let i = 0; i < idxPath.length; i++) {
    grid[i] = cellCenter(idxPath[i] % COLS, Math.floor(idxPath[i] / COLS))
  }
  const smoothed = smooth(grid)
  const tCellX = Math.floor(to.x / CELL)
  const tCellY = Math.floor(to.y / CELL)
  if (!isBlocked(tCellX, tCellY)) {
    smoothed[smoothed.length - 1] = { x: to.x, y: to.y }
  }
  // Drop first cell (≈ current position).
  return smoothed.slice(1)
}
