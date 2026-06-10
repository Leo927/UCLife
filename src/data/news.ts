// Date-keyed newsfeed content table (Phase 7.0.A). One hand-authored
// chronicle spanning UC 0077–0079, surfaced through the bar-TV channel and
// recorded into the player's journal only on the days they actually tune in
// (missability — see Design/social/newsfeed.md). The `date` key is canonical
// from day one: the same table feeds every future channel (newspaper, radio,
// gossip) and the 7.0.B war-day force-toast, so the schema must not churn.

import json5 from 'json5'
import raw from './news.json5?raw'
import { isCauseId, type CauseTags } from '../config/psychology'

export type NewsTag = 'war' | 'civic' | 'ae' | 'zeon' | 'federation' | 'lunar'

export interface NewsEntry {
  // Stable id — referenced by the journal (consumed set) + config
  // (war-day headline). Never reuse an id for different copy.
  id: string
  // Canonical UC date key, format `UC YYYY.MM.DD` (no time). Matched
  // against the live clock via ucDateKey().
  date: string
  // Higher = more prominent. The day's top-of-broadcast headline is the
  // highest-priority entry on that date; lower entries are b-roll.
  priority: number
  tags: NewsTag[]
  // Phase 5.3 — which ideological causes the event advances (+) or
  // antagonizes (-), -1..+1 per cause. Shared vocabulary with character
  // sympathies + faction alignment (Design/social/psychology.md); the
  // news-driven mood consumer lands with the mood system.
  causeTags?: CauseTags
  headlineZh: string
  bodyZh: string
}

interface NewsFile {
  entries: NewsEntry[]
}

const UC_DATE_RE = /^UC \d{4}\.\d{2}\.\d{2}$/
const VALID_TAGS: ReadonlySet<string> = new Set<NewsTag>([
  'war', 'civic', 'ae', 'zeon', 'federation', 'lunar',
])

const parsed = json5.parse(raw) as NewsFile

const byId = new Map<string, NewsEntry>()
const byDate = new Map<string, NewsEntry[]>()

for (const e of parsed.entries) {
  if (!e.id) throw new Error('news.json5: entry missing id')
  if (byId.has(e.id)) throw new Error(`news.json5: duplicate entry id "${e.id}"`)
  if (!UC_DATE_RE.test(e.date)) {
    throw new Error(`news.json5: entry "${e.id}" has malformed date "${e.date}" (want "UC YYYY.MM.DD")`)
  }
  if (typeof e.priority !== 'number' || !Number.isFinite(e.priority)) {
    throw new Error(`news.json5: entry "${e.id}" has non-numeric priority`)
  }
  for (const t of e.tags) {
    if (!VALID_TAGS.has(t)) throw new Error(`news.json5: entry "${e.id}" has unknown tag "${t}"`)
  }
  if (e.causeTags !== undefined) {
    for (const [cause, w] of Object.entries(e.causeTags)) {
      if (!isCauseId(cause)) {
        throw new Error(`news.json5: entry "${e.id}" has unknown causeTag "${cause}"`)
      }
      if (typeof w !== 'number' || !Number.isFinite(w) || Math.abs(w) > 1) {
        throw new Error(`news.json5: entry "${e.id}" causeTags.${cause} must be a number in [-1, 1]`)
      }
    }
  }
  byId.set(e.id, e)
  const list = byDate.get(e.date) ?? []
  list.push(e)
  byDate.set(e.date, list)
}

// Pre-sort each date's entries by descending priority so topHeadlineForDate
// is O(1) and getHeadlinesForDate returns broadcast order.
for (const list of byDate.values()) {
  list.sort((a, b) => b.priority - a.priority)
}

export const NEWS_ENTRIES: readonly NewsEntry[] = parsed.entries

export function getNewsEntry(id: string): NewsEntry | undefined {
  return byId.get(id)
}

export function getHeadlinesForDate(dateKey: string): readonly NewsEntry[] {
  return byDate.get(dateKey) ?? []
}

export function topHeadlineForDate(dateKey: string): NewsEntry | null {
  const list = byDate.get(dateKey)
  return list && list.length > 0 ? list[0] : null
}

// Canonical `UC YYYY.MM.DD` date key for a game Date. Mirrors the date half
// of clock.ts formatUC(); kept here (data layer) so news matching never
// reaches upward into sim/.
export function ucDateKey(d: Date): string {
  const yyyy = d.getFullYear().toString().padStart(4, '0')
  const mm = (d.getMonth() + 1).toString().padStart(2, '0')
  const dd = d.getDate().toString().padStart(2, '0')
  return `UC ${yyyy}.${mm}.${dd}`
}

// Monotonic ordinal (YYYYMMDD) for a game Date — order-comparable without
// JS Date math. Used by date-gated systems (the 7.0.B war trigger) to test
// "is the clock on or after date X" by comparing integers.
export function ucDateOrdinal(d: Date): number {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()
}

// Same ordinal from a canonical `UC YYYY.MM.DD` key. Throws on a malformed
// key so a typo'd config date fails loud rather than comparing as 0.
export function ucDateKeyOrdinal(key: string): number {
  if (!UC_DATE_RE.test(key)) {
    throw new Error(`ucDateKeyOrdinal: malformed UC date key "${key}" (want "UC YYYY.MM.DD")`)
  }
  const yyyy = Number(key.slice(3, 7))
  const mm = Number(key.slice(8, 10))
  const dd = Number(key.slice(11, 13))
  return yyyy * 10000 + mm * 100 + dd
}
