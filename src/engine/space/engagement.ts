import { Vec2 } from './types'

export function distSq(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

export function contact(a: Vec2, b: Vec2, combinedRadius: number): boolean {
  return distSq(a, b) <= combinedRadius * combinedRadius
}

export function inAggroRadius(
  source: Vec2,
  target: Vec2,
  aggroRadius: number,
): boolean {
  return distSq(source, target) <= aggroRadius * aggroRadius
}
