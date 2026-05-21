// Per-instance ship-name allocator. Flagship + delivered + fixture-loaded
// + save-restored ships all route here so the suffix counter stays
// monotonic across spawn paths. Saves persist the resolved `name` field
// verbatim, so the counter only matters at spawn time.

import type { ShipClassDef } from './ship-classes'
import { fleetConfig } from '../config'

const seqByTemplate: Record<string, number> = {}

export function defaultShipName(cls: Pick<ShipClassDef, 'id' | 'nameZh'>): string {
  const next = (seqByTemplate[cls.id] ?? 0) + 1
  seqByTemplate[cls.id] = next
  const pad = fleetConfig.shipNamePadDigits
  const seqStr = next.toString().padStart(pad, '0')
  return `${cls.nameZh} ${fleetConfig.shipNamePrefix}${seqStr}`
}

export function resetShipNameCounters(): void {
  for (const k of Object.keys(seqByTemplate)) delete seqByTemplate[k]
}

// Restore-time hook: the save handler calls this for each loaded ship so a
// subsequent runtime spawn doesn't reuse a sequence number already taken.
// Pass the persisted `name` string verbatim; if it matches the
// `${nameZh} ${prefix}${digits}` pattern we extract the seq and bump the
// counter past it. Names that don't match (legacy saves, player-renamed
// ships) leave the counter untouched.
export function noteRestoredShipName(templateId: string, name: string, classNameZh: string): void {
  if (!name) return
  const prefix = `${classNameZh} ${fleetConfig.shipNamePrefix}`
  if (!name.startsWith(prefix)) return
  const tail = name.slice(prefix.length)
  if (!/^\d+$/.test(tail)) return
  const seq = parseInt(tail, 10)
  const cur = seqByTemplate[templateId] ?? 0
  if (seq > cur) seqByTemplate[templateId] = seq
}
