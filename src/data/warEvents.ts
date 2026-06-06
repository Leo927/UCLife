// Date-keyed strategic-war event table (Phase 7.0.B). Mirrors the news.ts
// loader shape: parse + validate war-events.json5 at module load, index by
// canonical UC date so strategicWarSystem can resolve "today's" events in O(1).
// Lives in the data layer (alongside news.ts) so neither sim nor systems
// reaches upward for war-event content.

import json5 from 'json5'
import raw from './war-events.json5?raw'

export interface WarEvent {
  // Stable id — recorded in warState.resolvedEventIds for idempotency.
  id: string
  // Canonical UC date key, format "UC YYYY.MM.DD" (no time).
  date: string
  // Optional headline copy (zh-CN) for newsfeed / log surfacing by consumers.
  headlineZh?: string
  // Per-faction strength deltas applied on resolution. Keys are faction ids.
  strengthDelta?: Record<string, number>
  // Per-front control deltas (positive = toward Federation). Keys are front ids.
  frontShift?: Record<string, number>
}

interface WarEventsFile {
  events: WarEvent[]
}

const UC_DATE_RE = /^UC \d{4}\.\d{2}\.\d{2}$/

const parsed = json5.parse(raw) as WarEventsFile

const byId = new Map<string, WarEvent>()
const byDate = new Map<string, WarEvent[]>()

for (const e of parsed.events) {
  if (!e.id) throw new Error('war-events.json5: entry missing id')
  if (byId.has(e.id)) throw new Error(`war-events.json5: duplicate entry id "${e.id}"`)
  if (!UC_DATE_RE.test(e.date)) {
    throw new Error(`war-events.json5: entry "${e.id}" has malformed date "${e.date}" (want "UC YYYY.MM.DD")`)
  }
  byId.set(e.id, e)
  const list = byDate.get(e.date) ?? []
  list.push(e)
  byDate.set(e.date, list)
}

export const WAR_EVENTS: readonly WarEvent[] = parsed.events

export function getWarEvent(id: string): WarEvent | undefined {
  return byId.get(id)
}

export function getWarEventsForDate(dateKey: string): readonly WarEvent[] {
  return byDate.get(dateKey) ?? []
}
