import type {
  ProcgenItem, ProcgenWorkstationItem, ProcgenBedItem,
  ProcgenBarSeatItem, ProcgenQueueItem,
} from '../data/buildingTypes'
import type { DoorPlacement } from './slots'
import { worldConfig } from '../config'

const TILE = worldConfig.tilePx
const WALL_T = worldConfig.wallThicknessPx

export type PlacedProcgenItem = {
  x: number
  y: number
  item: ProcgenItem
  specId?: string  // resolved for workstation items
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

  const centerX = rect.x + Math.floor(rect.w / TILE / 2) * TILE + TILE / 2
  const supervisorY = rect.y + TILE + TILE / 2

  const workerZoneTop = partitionY !== null
    ? partitionY + WALL_T
    : rect.y + Math.floor(rect.h * 0.4)

  // Supervisor / counter workstations — all land at the same center position.
  const supervisorItems = items.filter(
    (i): i is ProcgenWorkstationItem =>
      i.type === 'workstation' && (i.role === 'supervisor' || i.role === 'counter'),
  )
  for (const item of supervisorItems) {
    const specIds = item.specIds ?? (item.specId ? [item.specId] : [])
    for (const specId of specIds) {
      result.push({ x: centerX, y: supervisorY, item, specId })
    }
    // Handle items with no specId/specIds (no-Interactable counter workstations)
    if (item.noInteractable && !item.specId && !item.specIds) {
      result.push({ x: centerX, y: supervisorY, item })
    }
  }

  // Customer row — placed 1 tile below supervisor, centered.
  const customerRowItems = items.filter(
    (i): i is ProcgenBarSeatItem => i.type === 'bar_seat' && i.role === 'customer_row',
  )
  for (const item of customerRowItems) {
    const count = item.count
    const rowY = supervisorY + TILE
    const startX = centerX - Math.floor((count - 1) / 2) * TILE
    for (let i = 0; i < count; i++) {
      result.push({ x: startX + i * TILE, y: rowY, item })
    }
  }

  // Worker grid — 2-column grid centered in the zone below partition.
  const workerItems = items.filter(
    (i): i is ProcgenWorkstationItem =>
      i.type === 'workstation' && i.role === 'worker',
  )
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
        specId: item.specId,
      })
    })
  }

  // Bed row — evenly spaced along the south wall.
  const bedRowItems = items.filter(
    (i): i is ProcgenBedItem => i.type === 'bed' && i.role === 'bed_row',
  )
  for (const item of bedRowItems) {
    const count = item.count ?? 1
    const bedY = rect.y + rect.h - TILE - WALL_T / 2
    for (let i = 0; i < count; i++) {
      result.push({ x: rect.x + (i + 1) * TILE + TILE / 2, y: bedY, item })
    }
  }

  // Queue point — near the primary door.
  const queueItem = items.find((i): i is ProcgenQueueItem => i.type === 'queue_point')
  if (queueItem) {
    const qx = rect.x + primaryDoor.offsetPx + primaryDoor.widthPx / 2
    const qy = (primaryDoor.side === 's' || primaryDoor.side === 'e')
      ? rect.y + rect.h - WALL_T - 12
      : rect.y + WALL_T + 12
    result.push({ x: qx, y: qy, item: queueItem })
  }

  return result
}
