// Buildings move per world seed, so this is the indirection layer between
// "the shop counter" and a concrete tile position. spawn.ts writes each
// landmark once at setupWorld; systems read via getLandmark().

export type LandmarkName = 'shopCounter' | 'shopApproach' | 'shopEntry' | 'shopExit' | 'barCounter' | 'barQueue'

// Outdoor survival-source registry — plural per kind. NPCs query nearest via
// getNearestRoughSource() during BT fallback.
export type RoughSourceKind = 'tap' | 'scavenge' | 'rough'
const roughSources: Record<RoughSourceKind, { x: number; y: number }[]> = {
  tap: [], scavenge: [], rough: [],
}

export function addRoughSource(kind: RoughSourceKind, pos: { x: number; y: number }): void {
  roughSources[kind].push({ x: pos.x, y: pos.y })
}

export function getRoughSources(kind: RoughSourceKind): { x: number; y: number }[] {
  return roughSources[kind]
}

export function getNearestRoughSource(
  kind: RoughSourceKind,
  pos: { x: number; y: number },
): { x: number; y: number } | null {
  const list = roughSources[kind]
  if (list.length === 0) return null
  let best = list[0]
  let bestD = Math.hypot(pos.x - best.x, pos.y - best.y)
  for (let i = 1; i < list.length; i++) {
    const d = Math.hypot(pos.x - list[i].x, pos.y - list[i].y)
    if (d < bestD) { bestD = d; best = list[i] }
  }
  return best
}

const landmarks = new Map<LandmarkName, { x: number; y: number }>()

// Without this, the entry-waypoint logic in goToShop() would bounce a buyer
// back outside on the next step — distTo(shopEntry) grows past ARRIVE_DIST
// once they cross the threshold.
let shopRect: { x: number; y: number; w: number; h: number } | null = null

export function setShopRect(rect: { x: number; y: number; w: number; h: number }): void {
  shopRect = { x: rect.x, y: rect.y, w: rect.w, h: rect.h }
}

export function isInsideShop(pos: { x: number; y: number }): boolean {
  if (!shopRect) return false
  return pos.x >= shopRect.x && pos.x < shopRect.x + shopRect.w
      && pos.y >= shopRect.y && pos.y < shopRect.y + shopRect.h
}

export function setLandmark(name: LandmarkName, pos: { x: number; y: number }): void {
  landmarks.set(name, { x: pos.x, y: pos.y })
}

// Throws on missing — consumers run only post-setupWorld(), so a missing
// key is a bug, not a recoverable condition.
export function getLandmark(name: LandmarkName): { x: number; y: number } {
  const pos = landmarks.get(name)
  if (!pos) throw new Error(`Landmark ${name} not initialized — setupWorld() must run first`)
  return pos
}

export function clearLandmarks(): void {
  landmarks.clear()
  shopRect = null
  roughSources.tap.length = 0
  roughSources.scavenge.length = 0
  roughSources.rough.length = 0
}
