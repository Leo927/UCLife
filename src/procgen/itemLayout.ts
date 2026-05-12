import type {
  ProcgenItem, ProcgenPlacedItem, ProcgenPartitionItem,
} from '../data/buildingTypes'
import { getObjectTemplate } from '../data/objectTemplates'
import type { DoorPlacement } from './slots'
import { worldConfig } from '../config'

const TILE = worldConfig.tilePx
const WALL_T = worldConfig.wallThicknessPx

export type PlacedProcgenItem = {
  x: number
  y: number
  item: ProcgenPlacedItem
}

function isPlacedItem(item: ProcgenItem): item is ProcgenPlacedItem {
  return 'role' in item
}

function isPartition(item: ProcgenItem): item is ProcgenPartitionItem {
  return !isPlacedItem(item) && getObjectTemplate(item.template).kind === 'partition'
}

export function findPartition(items: ProcgenItem[]): ProcgenPartitionItem | null {
  for (const it of items) if (isPartition(it)) return it
  return null
}

// Place items for an open_floor building. partitionY is the pixel Y of the
// horizontal partition wall (if any), which splits the floor into supervisor
// zone (above) and worker zone (below).
export function layoutOpenFloorItems(
  rect: { x: number; y: number; w: number; h: number },
  primaryDoor: DoorPlacement,
  items: ProcgenItem[],
  partitionY: number | null,
): PlacedProcgenItem[] {
  const result: PlacedProcgenItem[] = []
  const placed = items.filter(isPlacedItem)

  const centerX = rect.x + Math.floor(rect.w / TILE / 2) * TILE + TILE / 2
  const supervisorY = rect.y + TILE + TILE / 2

  const workerZoneTop = partitionY !== null
    ? partitionY + WALL_T
    : rect.y + Math.floor(rect.h * 0.4)

  // Supervisor / counter workstations — all land at the same center position.
  // Each item materializes once; multi-shift counters appear as multiple items
  // (e.g. shop_morning_clerk + shop_afternoon_clerk) all referencing the same
  // supervisor coordinate.
  const supervisorItems = placed.filter(
    (i) => i.role === 'supervisor' || i.role === 'counter',
  )
  for (const item of supervisorItems) {
    result.push({ x: centerX, y: supervisorY, item })
  }

  // Customer row — placed 1 tile below supervisor, centered.
  const customerRowItems = placed.filter((i) => i.role === 'customer_row')
  for (const item of customerRowItems) {
    const count = item.count ?? 1
    const rowY = supervisorY + TILE
    const startX = centerX - Math.floor((count - 1) / 2) * TILE
    for (let i = 0; i < count; i++) {
      result.push({ x: startX + i * TILE, y: rowY, item })
    }
  }

  // Worker grid — 2-column grid centered in the zone below partition.
  const workerItems = placed.filter((i) => i.role === 'worker')
  if (workerItems.length > 0) {
    const gridCols = Math.min(2, workerItems.length)
    const gridRows = Math.ceil(workerItems.length / gridCols)
    const spacing = TILE * 2
    const gridW = (gridCols - 1) * spacing
    const gridH = (gridRows - 1) * spacing
    const workerAreaH = rect.y + rect.h - WALL_T - workerZoneTop
    const gridStartX = centerX - Math.floor(gridW / 2 / TILE) * TILE
    const gridMidY = workerZoneTop + Math.floor(workerAreaH / 2)
    const gridStartY = gridMidY - Math.floor(gridH / 2)

    workerItems.forEach((item, idx) => {
      const col = idx % gridCols
      const row = Math.floor(idx / gridCols)
      result.push({
        x: gridStartX + col * spacing,
        y: gridStartY + row * spacing,
        item,
      })
    })
  }

  // Bed row — evenly spaced along the south wall.
  const bedRowItems = placed.filter((i) => i.role === 'bed_row')
  for (const item of bedRowItems) {
    const count = item.count ?? 1
    const bedY = rect.y + rect.h - TILE - WALL_T / 2
    for (let i = 0; i < count; i++) {
      result.push({ x: rect.x + (i + 1) * TILE + TILE / 2, y: bedY, item })
    }
  }

  // Queue point — near the primary door.
  const queueItem = placed.find((i) => i.role === 'queue')
  if (queueItem) {
    const qx = rect.x + primaryDoor.offsetPx + primaryDoor.widthPx / 2
    const qy = (primaryDoor.side === 's' || primaryDoor.side === 'e')
      ? rect.y + rect.h - WALL_T - 12
      : rect.y + WALL_T + 12
    result.push({ x: qx, y: qy, item: queueItem })
  }

  // Shop landmarks have their own roles (shopCounter / shopApproach /
  // shopEntry / shopExit). They don't get x/y here — spawn computes
  // their positions from the resolved counter + door geometry. Push them
  // with placeholder coords so the per-item walk still iterates them
  // and the spawn dispatcher sees the landmark templates.
  const landmarkRoles: ProcgenPlacedItem['role'][] = [
    'shopCounter', 'shopApproach', 'shopEntry', 'shopExit',
  ]
  for (const item of placed) {
    if (landmarkRoles.includes(item.role)) {
      result.push({ x: 0, y: 0, item })
    }
  }

  return result
}
