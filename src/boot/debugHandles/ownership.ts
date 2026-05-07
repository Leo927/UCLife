// Phase 5.5 ownership debug surface. Lets the smoke suite verify the
// faction-entity bootstrap and the per-building Owner default without
// reaching into koota internals.

import { registerDebugHandle } from '../../debug/uclifeHandle'
import { world } from '../../ecs/world'
import { Building, Faction, Owner } from '../../ecs/traits'

interface OwnerSummary {
  kind: 'state' | 'faction' | 'character'
  factionId: string | null
}

interface OwnershipSnapshot {
  factions: { id: string; fund: number }[]
  buildingsByOwnerKind: Record<'state' | 'faction' | 'character' | 'untagged', number>
  buildingsByFaction: Record<string, number>
}

registerDebugHandle('ownershipSnapshot', (): OwnershipSnapshot => {
  const factions: OwnershipSnapshot['factions'] = []
  for (const e of world.query(Faction)) {
    const f = e.get(Faction)!
    factions.push({ id: f.id, fund: f.fund })
  }
  const byKind: OwnershipSnapshot['buildingsByOwnerKind'] = {
    state: 0, faction: 0, character: 0, untagged: 0,
  }
  const byFaction: Record<string, number> = {}
  for (const b of world.query(Building)) {
    const o = b.get(Owner)
    if (!o) { byKind.untagged += 1; continue }
    byKind[o.kind] += 1
    if (o.kind === 'faction' && o.entity) {
      const f = o.entity.get(Faction)
      if (f) byFaction[f.id] = (byFaction[f.id] ?? 0) + 1
    }
  }
  return { factions, buildingsByOwnerKind: byKind, buildingsByFaction: byFaction }
})

registerDebugHandle('ownerOf', (label: string): OwnerSummary | null => {
  for (const b of world.query(Building)) {
    if (b.get(Building)!.label !== label) continue
    const o = b.get(Owner)
    if (!o) return null
    if (o.kind === 'faction' && o.entity) {
      const f = o.entity.get(Faction)
      return { kind: 'faction', factionId: f?.id ?? null }
    }
    return { kind: o.kind, factionId: null }
  }
  return null
})
