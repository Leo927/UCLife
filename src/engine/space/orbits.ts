import { Vec2, OrbitalParams, ParentResolver } from './types'

const TWO_PI = Math.PI * 2

export function derivedPos(
  params: OrbitalParams,
  tDays: number,
  resolveParent: ParentResolver,
): Vec2 {
  if (!Number.isFinite(tDays)) {
    throw new Error(`derivedPos: tDays must be finite, got ${tDays}`)
  }
  return derivedPosInternal(params, tDays, resolveParent, new Set<string>())
}

export function derivedPosById(
  id: string,
  tDays: number,
  resolve: ParentResolver,
): Vec2 {
  const params = resolve(id)
  if (!params) {
    throw new Error(`derivedPosById: unresolved id "${id}"`)
  }
  if (!Number.isFinite(tDays)) {
    throw new Error(`derivedPosById: tDays must be finite, got ${tDays}`)
  }
  const visited = new Set<string>([id])
  return derivedPosInternal(params, tDays, resolve, visited)
}

export function hasParentCycle(id: string, resolve: ParentResolver): boolean {
  const visited = new Set<string>()
  let cursor: string | null = id
  while (cursor !== null) {
    if (visited.has(cursor)) return true
    visited.add(cursor)
    const params: OrbitalParams | undefined = resolve(cursor)
    if (!params) return false
    cursor = params.parentId
  }
  return false
}

function derivedPosInternal(
  params: OrbitalParams,
  tDays: number,
  resolve: ParentResolver,
  visited: Set<string>,
): Vec2 {
  if (params.parentId === null) {
    if (!params.pos) {
      throw new Error(
        `derivedPos: root params missing pos (params=${JSON.stringify(params)})`,
      )
    }
    return { x: params.pos.x, y: params.pos.y }
  }

  const { parentId, orbitRadius, orbitPeriodDays, orbitPhase } = params
  if (
    typeof orbitRadius !== 'number' ||
    typeof orbitPeriodDays !== 'number' ||
    typeof orbitPhase !== 'number'
  ) {
    throw new Error(
      `derivedPos: non-root params missing orbit fields (params=${JSON.stringify(params)})`,
    )
  }
  if (orbitPeriodDays === 0) {
    throw new Error(
      `derivedPos: orbitPeriodDays must be non-zero (parentId=${parentId})`,
    )
  }
  if (visited.has(parentId)) {
    throw new Error(`derivedPos: parent cycle detected at "${parentId}"`)
  }
  visited.add(parentId)

  const parentParams = resolve(parentId)
  if (!parentParams) {
    throw new Error(`derivedPos: unresolved parentId "${parentId}"`)
  }
  const parentPos = derivedPosInternal(parentParams, tDays, resolve, visited)

  const angle = (tDays / orbitPeriodDays) * TWO_PI + orbitPhase
  return {
    x: parentPos.x + orbitRadius * Math.cos(angle),
    y: parentPos.y + orbitRadius * Math.sin(angle),
  }
}
