// Single-level HPA*. Port of hugoscurti/hierarchical-pathfinding (Unity, MIT)
// with the per-cell Node dict replaced by our typed-array A*.
//
// Why HPA: flat A* on 1600×1040 cells with cross-map paths explores tens of
// thousands of cells worst-case. HPA decomposes search into a small abstract
// graph between cluster boundaries — cross-map cost is O(clusters) and
// per-query work is two cluster-bounded A*s (start + dest segments).
//
// Per-requester correctness: the static graph is built against walls only
// (door tiles are walkable at build time), so a renter holding the key can
// use cached paths through their cell door. Non-renters get the escape
// hatch — refineCachedIntra falls back to bounded door-aware A* per query.
//
// Two correctness/perf gotchas:
//   - Intra edges build lazily the first time abstractAStar pops any
//     entrance from the cluster, not just for sCluster/tCluster. Without it,
//     intermediate clusters had only INTER edges and the abstract graph was
//     disconnected for non-adjacent (s,t) pairs — 0/105k cross-cluster
//     queries succeeded pre-fix.
//   - Wall-component fast-fail (built alongside the wall grid): if s and t
//     have different component ids, no walkable corridor can exist for any
//     requester (door overlays only add blocks). Skips abstract-exhaust on
//     truly unreachable destinations.

import type { World } from 'koota'
import { worldConfig } from '../config'
import { Door } from '../ecs/traits'
import { maxSceneTilesX, maxSceneTilesY } from '../data/scenes'
import { getActiveSceneId, type SceneId } from '../ecs/world'
import {
  getWallGrid, getDoorBlockedGrid,
  aStarOnIdx, getComponentOf,
} from './pathfinding'

// pathfinding.ts imports this module too — TDZ blows up on const re-imports
// during the cycle, so we only import its functions (declaration-hoisted).
const SUB = 2
const COLS = maxSceneTilesX * SUB
const ROWS = maxSceneTilesY * SUB
const CELL_PX = worldConfig.tilePx / SUB

// Perf @ mapScale=20: 32→28.7s/day, 8→11.7s/day, 4→11.0s/day. 4 quadruples
// cluster count + border-detect cost. 8 is the sweet spot.
const CLUSTER_SUB = 8
const CW = Math.ceil(COLS / CLUSTER_SUB)
const CH = Math.ceil(ROWS / CLUSTER_SUB)

// Below ~200 cells straight-line, temp-insert overhead exceeds flat A*'s
// explored frontier. Threshold in 10/14 octile cost units (200 cells × 10).
const HPA_MIN_COST = 2000

interface Cluster {
  id: number
  cx: number; cy: number
  minX: number; minY: number; maxX: number; maxY: number
  nodes: Map<number, AbstractNode>
  intraBuilt: boolean
  // Empty between queries; populated only by an active hpaFind call.
  tempNodes: AbstractNode[]
  // True iff any Door entity overlaps this cluster. False → refineCachedIntra
  // can short-circuit (door overlay can't stamp cells here).
  hasDoors: boolean
}

interface AbstractEdge {
  from: AbstractNode
  to: AbstractNode
  weight: number   // 10/14 octile-cost units
  // INTRA: cached path (inclusive endpoints) built against wall-only grid.
  // INTER: null — edge is one ortho step between paired border cells.
  path: number[] | null
  isInter: boolean
  temp: boolean
}

interface AbstractNode {
  cluster: Cluster
  cellIdx: number
  edges: AbstractEdge[]
  temp: boolean
  // Generation-stamped per-query bookkeeping; no clear between queries.
  gScore: number
  came: AbstractEdge | null
  closed: boolean
  inOpen: boolean
  gen: number
}

interface SceneHpa {
  clusters: Cluster[]
  dirty: boolean
}
// already keyed per scene: cluster graph is per-world (each scene has its
// own walls + door layout). Map<SceneId, SceneHpa> is the canonical shape.
const sceneHpa = new Map<SceneId, SceneHpa>()

function getSceneHpa(id: SceneId): SceneHpa {
  let h = sceneHpa.get(id)
  if (!h) {
    h = { clusters: [], dirty: true }
    sceneHpa.set(id, h)
  }
  return h
}

export function markHpaDirty(sceneId?: SceneId): void {
  const id = sceneId ?? getActiveSceneId()
  const h = getSceneHpa(id)
  h.dirty = true
  h.clusters = []
}

// Flip `enabled` on from devtools (`__uclife__.world` won't reach this; do
// `import('/src/systems/hpa').then(m => m.hpaStats.enabled = true)` from the
// console) when you need the per-query counters. Negligible overhead off.
export const hpaStats = {
  enabled: false,
  queries: 0,
  thresholdHits: 0,
  sameCluster: 0,
  crossCluster: 0,
  buildMs: 0,
  intraMs: 0,
  insertMs: 0,
  abstractMs: 0,
  refineMs: 0,
  flatMs: 0,
  refineDoorless: 0,
  refineCheck: 0,
  refineRebuild: 0,
  abstractNodesPopped: 0,
  abstractFailures: 0,
  abstractSuccess: 0,
  componentFastFail: 0,
}
export function resetHpaStats(): void {
  hpaStats.queries = 0
  hpaStats.thresholdHits = 0
  hpaStats.sameCluster = 0
  hpaStats.crossCluster = 0
  hpaStats.buildMs = 0
  hpaStats.intraMs = 0
  hpaStats.insertMs = 0
  hpaStats.abstractMs = 0
  hpaStats.refineMs = 0
  hpaStats.flatMs = 0
  hpaStats.refineDoorless = 0
  hpaStats.refineCheck = 0
  hpaStats.refineRebuild = 0
  hpaStats.abstractNodesPopped = 0
  hpaStats.abstractFailures = 0
  hpaStats.abstractSuccess = 0
  hpaStats.componentFastFail = 0
}

function clusterIdOfCell(cellIdx: number): number {
  const x = cellIdx % COLS
  const y = (cellIdx / COLS) | 0
  return ((y / CLUSTER_SUB) | 0) * CW + ((x / CLUSTER_SUB) | 0)
}

function buildClustersIfNeeded(world: World): SceneHpa {
  const h = getSceneHpa(getActiveSceneId())
  if (!h.dirty && h.clusters.length > 0) return h
  const wall = getWallGrid(world)
  const clusters: Cluster[] = []
  for (let cy = 0; cy < CH; cy++) {
    for (let cx = 0; cx < CW; cx++) {
      const id = cy * CW + cx
      const minX = cx * CLUSTER_SUB
      const minY = cy * CLUSTER_SUB
      const maxX = Math.min(minX + CLUSTER_SUB - 1, COLS - 1)
      const maxY = Math.min(minY + CLUSTER_SUB - 1, ROWS - 1)
      clusters.push({
        id, cx, cy, minX, minY, maxX, maxY,
        nodes: new Map(),
        intraBuilt: false,
        tempNodes: [],
        hasDoors: false,
      })
    }
  }
  // markPathfindingDirty() invalidates both wall grid and cluster graph,
  // so this stamp stays in sync with door churn.
  for (const dEnt of world.query(Door)) {
    const d = dEnt.get(Door)!
    const sx0 = Math.max(0, Math.floor(d.x / CELL_PX))
    const sx1 = Math.min(COLS - 1, Math.floor((d.x + d.w - 1) / CELL_PX))
    const sy0 = Math.max(0, Math.floor(d.y / CELL_PX))
    const sy1 = Math.min(ROWS - 1, Math.floor((d.y + d.h - 1) / CELL_PX))
    const cx0 = (sx0 / CLUSTER_SUB) | 0
    const cx1 = (sx1 / CLUSTER_SUB) | 0
    const cy0 = (sy0 / CLUSTER_SUB) | 0
    const cy1 = (sy1 / CLUSTER_SUB) | 0
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        clusters[cy * CW + cx].hasDoors = true
      }
    }
  }
  for (let cy = 0; cy < CH; cy++) {
    for (let cx = 0; cx + 1 < CW; cx++) {
      const c1 = clusters[cy * CW + cx]
      const c2 = clusters[cy * CW + cx + 1]
      detectVerticalBorder(c1, c2, wall)
    }
  }
  for (let cy = 0; cy + 1 < CH; cy++) {
    for (let cx = 0; cx < CW; cx++) {
      const c1 = clusters[cy * CW + cx]
      const c2 = clusters[(cy + 1) * CW + cx]
      detectHorizontalBorder(c1, c2, wall)
    }
  }
  h.clusters = clusters
  h.dirty = false
  return h
}

// c1 left of c2.
function detectVerticalBorder(c1: Cluster, c2: Cluster, wall: Uint8Array): void {
  const x1 = c1.maxX, x2 = c2.minX
  let runStart = -1
  for (let y = c1.minY; y <= c1.maxY; y++) {
    const free = wall[y * COLS + x1] === 0 && wall[y * COLS + x2] === 0
    if (free) {
      if (runStart === -1) runStart = y
    } else {
      if (runStart !== -1) {
        emitVerticalEntrances(c1, c2, x1, x2, runStart, y - 1)
        runStart = -1
      }
    }
  }
  if (runStart !== -1) emitVerticalEntrances(c1, c2, x1, x2, runStart, c1.maxY)
}

function emitVerticalEntrances(
  c1: Cluster, c2: Cluster, x1: number, x2: number,
  runStart: number, runEnd: number,
): void {
  const len = runEnd - runStart + 1
  if (len <= 5) {
    const y = runStart + ((len / 2) | 0)
    pairEntrance(c1, c2, y * COLS + x1, y * COLS + x2)
  } else {
    pairEntrance(c1, c2, runStart * COLS + x1, runStart * COLS + x2)
    pairEntrance(c1, c2, runEnd * COLS + x1, runEnd * COLS + x2)
  }
}

// c1 above c2.
function detectHorizontalBorder(c1: Cluster, c2: Cluster, wall: Uint8Array): void {
  const y1 = c1.maxY, y2 = c2.minY
  let runStart = -1
  for (let x = c1.minX; x <= c1.maxX; x++) {
    const free = wall[y1 * COLS + x] === 0 && wall[y2 * COLS + x] === 0
    if (free) {
      if (runStart === -1) runStart = x
    } else {
      if (runStart !== -1) {
        emitHorizontalEntrances(c1, c2, y1, y2, runStart, x - 1)
        runStart = -1
      }
    }
  }
  if (runStart !== -1) emitHorizontalEntrances(c1, c2, y1, y2, runStart, c1.maxX)
}

function emitHorizontalEntrances(
  c1: Cluster, c2: Cluster, y1: number, y2: number,
  runStart: number, runEnd: number,
): void {
  const len = runEnd - runStart + 1
  if (len <= 5) {
    const x = runStart + ((len / 2) | 0)
    pairEntrance(c1, c2, y1 * COLS + x, y2 * COLS + x)
  } else {
    pairEntrance(c1, c2, y1 * COLS + runStart, y2 * COLS + runStart)
    pairEntrance(c1, c2, y1 * COLS + runEnd, y2 * COLS + runEnd)
  }
}

function pairEntrance(c1: Cluster, c2: Cluster, idx1: number, idx2: number): void {
  const n1 = getOrCreateEntranceNode(c1, idx1)
  const n2 = getOrCreateEntranceNode(c2, idx2)
  const e1: AbstractEdge = { from: n1, to: n2, weight: 10, path: null, isInter: true, temp: false }
  const e2: AbstractEdge = { from: n2, to: n1, weight: 10, path: null, isInter: true, temp: false }
  n1.edges.push(e1)
  n2.edges.push(e2)
}

function getOrCreateEntranceNode(c: Cluster, cellIdx: number): AbstractNode {
  const existing = c.nodes.get(cellIdx)
  if (existing) return existing
  const n: AbstractNode = {
    cluster: c, cellIdx, edges: [],
    temp: false, gScore: 0, came: null, closed: false, inOpen: false, gen: -1,
  }
  c.nodes.set(cellIdx, n)
  return n
}

// Connects every pair of entrance nodes via bounded A* against walls only.
function ensureIntraEdges(c: Cluster, world: World): void {
  if (c.intraBuilt) return
  c.intraBuilt = true
  const wall = getWallGrid(world)
  const entranceNodes: AbstractNode[] = []
  for (const n of c.nodes.values()) entranceNodes.push(n)
  for (let i = 0; i < entranceNodes.length; i++) {
    const ni = entranceNodes[i]
    for (let j = i + 1; j < entranceNodes.length; j++) {
      const nj = entranceNodes[j]
      const path = aStarOnIdx(wall, ni.cellIdx, nj.cellIdx, c.minX, c.minY, c.maxX, c.maxY)
      if (!path || path.length === 0) continue
      const w = pathCost(path)
      const eFwd: AbstractEdge = { from: ni, to: nj, weight: w, path, isInter: false, temp: false }
      const rev = path.slice().reverse()
      const eBack: AbstractEdge = { from: nj, to: ni, weight: w, path: rev, isInter: false, temp: false }
      ni.edges.push(eFwd)
      nj.edges.push(eBack)
    }
  }
}

// Each step is ortho (10) or diag (14); trusted from aStarOnIdx.
function pathCost(path: number[]): number {
  let cost = 0
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i]
    const ax = a % COLS, ay = (a / COLS) | 0
    const bx = b % COLS, by = (b / COLS) | 0
    const dx = bx - ax, dy = by - ay
    cost += (dx !== 0 && dy !== 0) ? 14 : 10
  }
  return cost
}

// per-active-scene only: queryGen + the abstract heap below are scratch
// for a single hpaFind() call against the active scene's cluster graph.
// Only one findPath runs at a time (synchronous from a system tick), so
// module scope is safe.
let queryGen = 0

// pathfinding.ts findPath calls setBlockedFor first so the door overlay is
// current for `requester`.
export function hpaFind(world: World, sIdx: number, tIdx: number): number[] | null {
  if (sIdx === tIdx) return [sIdx]
  const blocked = getDoorBlockedGrid()
  // Door overlay may block endpoints already snapped against the wall grid.
  if (blocked[sIdx] === 1 || blocked[tIdx] === 1) return null

  const PROF = hpaStats.enabled
  if (PROF) hpaStats.queries++

  // Wall-component fast-fail: door overlays only add blocks, so different
  // component ids ⇒ no path for any requester.
  const cs = getComponentOf(world, sIdx)
  const ct = getComponentOf(world, tIdx)
  if (cs === 0 || ct === 0 || cs !== ct) {
    if (PROF) hpaStats.componentFastFail++
    return null
  }

  let h: SceneHpa
  if (PROF) {
    const t0 = performance.now()
    h = buildClustersIfNeeded(world)
    hpaStats.buildMs += performance.now() - t0
  } else {
    h = buildClustersIfNeeded(world)
  }
  const sCluster = h.clusters[clusterIdOfCell(sIdx)]
  const tCluster = h.clusters[clusterIdOfCell(tIdx)]

  // Insert temp nodes up-front. This has two purposes: (1) lets abstract A*
  // run later without re-inserting, (2) gives us a per-requester reachability
  // signal — a fresh temp with zero edges means the endpoint is isolated
  // within its cluster under the current door overlay (locked-room case).
  // Without that fast-fail, flat or abstract A* would exhaust the entire
  // reachable region looking for an unreachable endpoint, freezing for ~1s.
  let sNode: AbstractNode, tNode: AbstractNode
  if (PROF) {
    const t0 = performance.now()
    sNode = insertTempNode(sCluster, sIdx, blocked, true)
    tNode = insertTempNode(tCluster, tIdx, blocked, false)
    hpaStats.insertMs += performance.now() - t0
  } else {
    sNode = insertTempNode(sCluster, sIdx, blocked, true)
    tNode = insertTempNode(tCluster, tIdx, blocked, false)
  }

  try {
    // Fresh temp with zero edges = endpoint isolated in its cluster under
    // the door overlay. (Reused entrance nodes always have ≥1 edge from
    // pairEntrance, so .temp distinguishes the fresh case cleanly.)
    if ((sNode.temp && sNode.edges.length === 0) || (tNode.temp && tNode.edges.length === 0)) {
      if (PROF) hpaStats.componentFastFail++
      return null
    }

    // Same cluster: bounded flat A* on door-aware grid. Falls through to the
    // abstract path if the cluster is split by a wall.
    if (sCluster === tCluster) {
      if (PROF) hpaStats.sameCluster++
      const direct = aStarOnIdx(blocked, sIdx, tIdx, sCluster.minX, sCluster.minY, sCluster.maxX, sCluster.maxY)
      if (direct && direct.length > 0) return direct
    }

    // Short cross-cluster paths: bounded flat A* over the cluster bbox
    // expanded by one cluster on each side. Replaces the previous full-map
    // flat A* — that would exhaust the whole reachable region on dead-end
    // targets that slipped past the isolation check (e.g. clusters that span
    // a door but the door blocks the only useful direction). If the bounded
    // attempt fails, falls through to abstract A*.
    if (octileEstimate(sIdx, tIdx) < HPA_MIN_COST) {
      if (PROF) hpaStats.thresholdHits++
      const minCx = Math.max(0, Math.min(sCluster.cx, tCluster.cx) - 1)
      const maxCx = Math.min(CW - 1, Math.max(sCluster.cx, tCluster.cx) + 1)
      const minCy = Math.max(0, Math.min(sCluster.cy, tCluster.cy) - 1)
      const maxCy = Math.min(CH - 1, Math.max(sCluster.cy, tCluster.cy) + 1)
      const bMinX = minCx * CLUSTER_SUB
      const bMaxX = Math.min(COLS - 1, (maxCx + 1) * CLUSTER_SUB - 1)
      const bMinY = minCy * CLUSTER_SUB
      const bMaxY = Math.min(ROWS - 1, (maxCy + 1) * CLUSTER_SUB - 1)
      let r: number[] | null
      if (PROF) {
        const t0 = performance.now()
        r = aStarOnIdx(blocked, sIdx, tIdx, bMinX, bMinY, bMaxX, bMaxY)
        hpaStats.flatMs += performance.now() - t0
      } else {
        r = aStarOnIdx(blocked, sIdx, tIdx, bMinX, bMinY, bMaxX, bMaxY)
      }
      if (r && r.length > 0) return r
    }

    if (PROF && sCluster !== tCluster) hpaStats.crossCluster++
    return abstractAStar(sNode, tNode, blocked, world)
  } finally {
    teardownTempNodes(sCluster)
    if (tCluster !== sCluster) teardownTempNodes(tCluster)
  }
}

function insertTempNode(c: Cluster, cellIdx: number, blocked: Uint8Array, _isStart: boolean): AbstractNode {
  // If cellIdx coincides with an entrance, reuse it — its edges are already
  // wired. teardownTempNodes skips it (temp=false).
  let n = c.nodes.get(cellIdx)
  if (n) return n
  n = {
    cluster: c, cellIdx, edges: [],
    temp: true, gScore: 0, came: null, closed: false, inOpen: false, gen: -1,
  }
  c.tempNodes.push(n)
  // Fully-walled cluster (no entrances): n stays edgeless and abstract A*
  // returns null upstream, correctly indicating an isolated endpoint.
  for (const e of c.nodes.values()) {
    const path = aStarOnIdx(blocked, cellIdx, e.cellIdx, c.minX, c.minY, c.maxX, c.maxY)
    if (!path || path.length === 0) continue
    const w = pathCost(path)
    const fwd: AbstractEdge = { from: n, to: e, weight: w, path, isInter: false, temp: true }
    const rev = path.slice().reverse()
    const back: AbstractEdge = { from: e, to: n, weight: w, path: rev, isInter: false, temp: true }
    n.edges.push(fwd)
    e.edges.push(back)
  }
  return n
}

function teardownTempNodes(c: Cluster): void {
  if (c.tempNodes.length === 0) return
  for (const tempN of c.tempNodes) {
    for (const e of tempN.edges) {
      const arr = e.to.edges
      for (let i = arr.length - 1; i >= 0; i--) {
        if (arr[i].temp && arr[i].to === tempN) {
          arr.splice(i, 1)
        }
      }
    }
  }
  c.tempNodes.length = 0
}

const _absHeap: AbstractNode[] = []
const _absHeapF: number[] = []

function absHeapPush(n: AbstractNode, f: number): void {
  let i = _absHeap.length
  _absHeap.push(n)
  _absHeapF.push(f)
  while (i > 0) {
    const p = (i - 1) >> 1
    if (_absHeapF[p] <= _absHeapF[i]) break
    const tn = _absHeap[i]; _absHeap[i] = _absHeap[p]; _absHeap[p] = tn
    const tf = _absHeapF[i]; _absHeapF[i] = _absHeapF[p]; _absHeapF[p] = tf
    i = p
  }
}

function absHeapPop(): AbstractNode {
  const top = _absHeap[0]
  const last = _absHeap.pop()!
  const lastF = _absHeapF.pop()!
  if (_absHeap.length > 0) {
    _absHeap[0] = last
    _absHeapF[0] = lastF
    let i = 0
    const n = _absHeap.length
    for (;;) {
      const l = i * 2 + 1, r = l + 1
      let s = i
      if (l < n && _absHeapF[l] < _absHeapF[s]) s = l
      if (r < n && _absHeapF[r] < _absHeapF[s]) s = r
      if (s === i) break
      const tn = _absHeap[i]; _absHeap[i] = _absHeap[s]; _absHeap[s] = tn
      const tf = _absHeapF[i]; _absHeapF[i] = _absHeapF[s]; _absHeapF[s] = tf
      i = s
    }
  }
  return top
}

function octileEstimate(aIdx: number, bIdx: number): number {
  const ax = aIdx % COLS, ay = (aIdx / COLS) | 0
  const bx = bIdx % COLS, by = (bIdx / COLS) | 0
  const dx = Math.abs(ax - bx), dy = Math.abs(ay - by)
  return 10 * (dx + dy) + (14 - 20) * Math.min(dx, dy)
}

function abstractAStar(sNode: AbstractNode, tNode: AbstractNode, blocked: Uint8Array, world: World): number[] | null {
  const PROF = hpaStats.enabled
  const tStart = PROF ? performance.now() : 0
  queryGen++
  _absHeap.length = 0
  _absHeapF.length = 0

  sNode.gen = queryGen
  sNode.gScore = 0
  sNode.came = null
  sNode.closed = false
  sNode.inOpen = true
  absHeapPush(sNode, octileEstimate(sNode.cellIdx, tNode.cellIdx))

  while (_absHeap.length > 0) {
    const cur = absHeapPop()
    if (cur.closed) continue
    cur.closed = true
    if (PROF) hpaStats.abstractNodesPopped++
    if (cur === tNode) {
      if (PROF) {
        hpaStats.abstractMs += performance.now() - tStart
        hpaStats.abstractSuccess++
        const tR = performance.now()
        const r = refineAbstractPath(cur, blocked)
        hpaStats.refineMs += performance.now() - tR
        return r
      }
      return refineAbstractPath(cur, blocked)
    }
    // Lazy intra-edge build distributes cost across queries that actually
    // need it. Skip for temp nodes — their cluster's entrances already wire
    // back via temp INTRA from insertTempNode.
    if (PROF) {
      if (!cur.temp && !cur.cluster.intraBuilt) {
        const tI = performance.now()
        ensureIntraEdges(cur.cluster, world)
        hpaStats.intraMs += performance.now() - tI
      }
    } else if (!cur.temp) {
      ensureIntraEdges(cur.cluster, world)
    }
    for (let i = 0; i < cur.edges.length; i++) {
      const e = cur.edges[i]
      // INTER edges aren't refined by refineAbstractPath — both border cells
      // are emitted verbatim. Filter per-requester here so abstract A* can't
      // route through a locked door tile that happens to sit on a cluster
      // boundary (entrance detection runs against the wall-only grid, so door
      // tiles are valid entrances even when the door is locked for us).
      if (e.isInter && (blocked[e.from.cellIdx] === 1 || blocked[e.to.cellIdx] === 1)) continue
      const nb = e.to
      if (nb.gen !== queryGen) {
        nb.gen = queryGen
        nb.gScore = Infinity
        nb.came = null
        nb.closed = false
        nb.inOpen = false
      }
      if (nb.closed) continue
      const g = cur.gScore + e.weight
      if (g >= nb.gScore) continue
      nb.gScore = g
      nb.came = e
      const f = g + octileEstimate(nb.cellIdx, tNode.cellIdx)
      absHeapPush(nb, f)
      nb.inOpen = true
    }
  }
  if (PROF) {
    hpaStats.abstractMs += performance.now() - tStart
    hpaStats.abstractFailures++
  }
  return null
}

function refineAbstractPath(dest: AbstractNode, blocked: Uint8Array): number[] {
  const edgeSeq: AbstractEdge[] = []
  let cur: AbstractNode | null = dest
  while (cur && cur.came) {
    edgeSeq.push(cur.came)
    cur = cur.came.from
  }
  edgeSeq.reverse()

  const out: number[] = [edgeSeq.length > 0 ? edgeSeq[0].from.cellIdx : dest.cellIdx]

  for (let i = 0; i < edgeSeq.length; i++) {
    const e = edgeSeq[i]
    let segment: number[] | null
    if (e.isInter) {
      segment = [e.from.cellIdx, e.to.cellIdx]
    } else if (e.temp) {
      // Temp INTRA already built against door-aware grid.
      segment = e.path
    } else {
      // Permanent INTRA built against walls only — verify against the
      // requester's blocked overlay; bounded A* fallback if it diffs.
      segment = refineCachedIntra(e, blocked)
      if (segment === null) return out
    }
    // Skip first cell — duplicates the last cell of the previous segment.
    for (let j = 1; j < segment!.length; j++) out.push(segment![j])
  }

  return out
}

// Doorless cluster → door overlay can't stamp it → return cached path.
function refineCachedIntra(e: AbstractEdge, blocked: Uint8Array): number[] | null {
  const path = e.path!
  const c = e.from.cluster
  if (!c.hasDoors) {
    if (hpaStats.enabled) hpaStats.refineDoorless++
    return path
  }
  if (hpaStats.enabled) hpaStats.refineCheck++
  let needsRebuild = false
  for (let i = 0; i < path.length; i++) {
    if (blocked[path[i]] === 1) { needsRebuild = true; break }
  }
  if (!needsRebuild) return path
  if (hpaStats.enabled) hpaStats.refineRebuild++
  return aStarOnIdx(blocked, e.from.cellIdx, e.to.cellIdx, c.minX, c.minY, c.maxX, c.maxY)
}
