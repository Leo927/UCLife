// The pool is intentionally small — duplicate names are part of the city
// texture, but `pickFreshName` avoids reusing a name held by a *living* NPC
// so the event log stays readable. Reusable once the owner dies.

import type { World } from 'koota'
import { Character, Health } from '../ecs/traits'

const SURNAMES = [
  '王', '李', '张', '刘', '陈', '杨', '黄', '赵', '吴', '周',
  '徐', '孙', '马', '朱', '胡', '林', '高', '何', '郭', '罗',
  '田中', '佐藤', '鈴木', '高橋', '伊藤', '渡辺', '中村', '小林', '加藤', '山田',
] as const

const GIVEN_NAMES = [
  '伟', '强', '军', '杰', '勇', '磊', '建国', '志强', '建华', '明',
  '丽', '芳', '娜', '艳', '婷', '玉兰', '秀英', '小红', '佳怡', '思琪',
  '一郎', '太郎', '健司', '誠', '健一', '正夫', '彰',
  '惠子', '佳子', '美咲', '雅子', '裕子', '陽子', '直美',
] as const

const COLORS = [
  '#3b82f6', '#ec4899', '#84cc16', '#f97316', '#a855f7', '#737373',
  '#facc15', '#dc2626', '#0ea5e9', '#14b8a6', '#fb923c', '#d946ef',
  '#10b981', '#e11d48', '#65a30d', '#8b5cf6', '#06b6d4', '#f59e0b',
] as const

let anonymousCounter = 0

export function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

export function pickRandomColor(): string {
  return pickRandom(COLORS)
}

// After 30 collisions falls back to '市民N' so a saturated pool never
// deadlocks the spawner.
export function pickFreshName(world: World): string {
  const used = new Set<string>()
  for (const e of world.query(Character, Health)) {
    if (e.get(Health)!.dead) continue
    used.add(e.get(Character)!.name)
  }
  for (let attempt = 0; attempt < 30; attempt++) {
    const name = pickRandom(SURNAMES) + pickRandom(GIVEN_NAMES)
    if (!used.has(name)) return name
  }
  anonymousCounter += 1
  return `市民${anonymousCounter}`
}

export function getAnonymousCounter(): number {
  return anonymousCounter
}

export function setAnonymousCounter(n: number): void {
  anonymousCounter = n
}

export function resetNameGen(): void {
  anonymousCounter = 0
}
