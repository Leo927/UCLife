import { useTrait } from 'koota/react'
import type { Entity } from 'koota'
import { Building, Character, Hangar, Job, Position, Workstation } from '../../../ecs/traits'
import type { HangarSlotClass } from '../../../ecs/traits'
import { world } from '../../../ecs/world'
import { dialogueText } from '../../../data/dialogueText'
import type { DialogueCtx, DialogueNode } from '../types'

export function hangarManagerBranch(ctx: DialogueCtx): DialogueNode | null {
  if (!ctx.roles.isHangarManagerOnDuty) return null
  return {
    id: 'hangarManager',
    label: dialogueText.buttons.hangarManager,
    info: (ctx.npc.get(Character)?.name ?? '主管') + dialogueText.branches.hangarManager.titleSuffix,
    specialUI: () => <HangarManagerPanel manager={ctx.npc} />,
  }
}

function HangarManagerPanel({ manager }: { manager: Entity }) {
  const info = useTrait(manager, Character)
  const job = useTrait(manager, Job)

  const station = job?.workstation ?? null
  const wsTrait = station?.get(Workstation) ?? null
  if (!station || !wsTrait || wsTrait.occupant !== manager) return null

  const building = findHangarBuilding(station)
  const hangar = building?.get(Hangar) ?? null
  if (!building || !hangar) return null

  const t = dialogueText.branches.hangarManager
  const tierLabel = t.tierLabel[hangar.tier]
  const slotEntries = Object.entries(hangar.slotCapacity) as Array<[HangarSlotClass, number]>

  return (
    <>
      <h3>{info?.name ?? '主管'}{t.titleSuffix}</h3>
      <div className="hr-intro">{tierLabel} · {t.intro}</div>
      {slotEntries.length === 0 ? (
        <p className="hr-intro">{t.emptyHint}</p>
      ) : (
        <ul className="dialog-options" style={{ listStyle: 'none', padding: 0 }}>
          {slotEntries.map(([cls, total]) => (
            <li key={cls} className="dev-row">
              <span className="dev-key">{t.slotLabel[cls]}</span>
              <span>0 / {total}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function findHangarBuilding(station: Entity): Entity | null {
  const sp = station.get(Position)
  if (!sp) return null
  for (const b of world.query(Building, Hangar)) {
    const bld = b.get(Building)!
    if (sp.x < bld.x || sp.x >= bld.x + bld.w) continue
    if (sp.y < bld.y || sp.y >= bld.y + bld.h) continue
    return b
  }
  return null
}
