import { useState, useEffect } from 'react'
import { useTrait } from 'koota/react'
import type { Entity } from 'koota'
import {
  Building, Character, Hangar, Job, Position, Workstation, EntityKey, Ship,
} from '../../../ecs/traits'
import type { HangarSlotClass } from '../../../ecs/traits'
import { world, getWorld } from '../../../ecs/world'
import { dialogueText } from '../../../data/dialogueText'
import { describeHangarRepair } from '../../../systems/hangarRepair'
import {
  deriveHangarOccupancy, poiIdForHangarScene, receiveDelivery,
} from '../../../systems/shipDelivery'
import { getShipClass } from '../../../data/ship-classes'
import { useUI } from '../../uiStore'
import { useClock, gameDayNumber } from '../../../sim/clock'
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
  const hangarTrait = useTrait(building, Hangar)
  if (!building || !hangarTrait) return null

  const t = dialogueText.branches.hangarManager
  const tierLabel = t.tierLabel[hangarTrait.tier]
  const slotEntries = Object.entries(hangarTrait.slotCapacity) as Array<[HangarSlotClass, number]>
  const sceneId = sceneIdForBuilding(building)
  const poiId = sceneId ? poiIdForHangarScene(sceneId) : null
  const occupancy = poiId ? deriveHangarOccupancy(poiId) : {}

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
              <span>{occupancy[cls] ?? 0} / {total}</span>
            </li>
          ))}
        </ul>
      )}
      {sceneId && <PendingDeliveriesPanel hangar={building} sceneId={sceneId} />}
      {sceneId && <RepairPriorityPanel hangar={building} sceneId={sceneId} />}
    </>
  )
}

function PendingDeliveriesPanel({ hangar, sceneId }: { hangar: Entity; sceneId: string }) {
  const h = useTrait(hangar, Hangar)
  // Live re-render so countdowns reflect a wall-clock day-rollover.
  void useTrait(hangar, Building)
  const today = gameDayNumber(useClock((s) => s.gameDate))
  const t = dialogueText.branches.hangarManager
  if (!h) return null
  if (h.pendingDeliveries.length === 0) return null

  const onReceive = (idx: number) => {
    const res = receiveDelivery(hangar, sceneId, idx)
    if (!res.ok) {
      useUI.getState().showToast(t.toastDeliveryFailed.replace('{reason}', res.reason))
      return
    }
    const cls = getShipClass(h.pendingDeliveries[idx].shipClassId)
    const hangarLabel = hangar.get(Building)?.label ?? ''
    useUI.getState().showToast(
      t.toastDeliveryReceived.replace('{ship}', cls.nameZh).replace('{hangar}', hangarLabel),
    )
  }

  return (
    <section style={{ marginTop: 12 }}>
      <h3>{t.deliveriesHeader}</h3>
      <ul className="dialog-options" style={{ listStyle: 'none', padding: 0 }}>
        {h.pendingDeliveries.map((row, idx) => {
          const cls = getShipClass(row.shipClassId)
          const remaining = Math.max(0, row.arrivalDay - today)
          const status = row.status === 'arrived'
            ? t.deliveryArrivedFmt
            : t.deliveryInTransitFmt
                .replace('{n}', String(remaining))
                .replace('{orderDay}', String(row.orderDay))
                .replace('{arrivalDay}', String(row.arrivalDay))
          const arrived = row.status === 'arrived'
          return (
            <li key={idx} className="dev-row" data-delivery-row={idx}>
              <span className="dev-key">{cls.nameZh}</span>
              <span>{status}</span>
              <button
                className="dialog-option"
                data-receive-delivery={idx}
                onClick={() => onReceive(idx)}
                disabled={!arrived}
                style={{ marginLeft: 8 }}
              >
                {t.receiveDeliveryButton}
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function RepairPriorityPanel({ hangar, sceneId }: { hangar: Entity; sceneId: string }) {
  // useTrait + the half-second poll cover both reactive paths: trait
  // mutation (manager-set priority) re-renders via koota; off-trait
  // mutation (a repair tick advances hull) is picked up by the timer.
  // describeHangarRepair re-reads on each render.
  useTrait(hangar, Hangar)
  const [, bump] = useState(0)
  useEffect(() => {
    const id = setInterval(() => bump((n) => n + 1), 500)
    return () => clearInterval(id)
  }, [])

  const t = dialogueText.branches.hangarManager
  const desc = describeHangarRepair(hangar, sceneId)

  const damagedShips = desc.damagedShipKeys.map((key) => {
    const ship = findShipByKey(key)
    if (!ship) return null
    const s = ship.get(Ship)!
    const name = shipDisplayName(s.templateId)
    const deficit = (s.hullMax - s.hullCurrent) + (s.armorMax - s.armorCurrent)
    return { key, name, deficit }
  }).filter((r): r is { key: string; name: string; deficit: number } => r !== null)

  const priorityName = desc.priorityShipKey
    ? damagedShips.find((d) => d.key === desc.priorityShipKey)?.name ?? desc.priorityShipKey
    : null

  return (
    <>
      <h3 style={{ marginTop: 12 }}>{t.repairHeader}</h3>
      <div className="hr-intro">
        {t.repairThroughputLabel}: {Math.round(desc.throughput)} {t.repairUnit}
      </div>
      {damagedShips.length === 0 ? (
        <p className="hr-intro">{t.repairEmpty}</p>
      ) : (
        <>
          <div className="hr-intro">
            {priorityName ? `${t.repairPriorityActive}${priorityName}` : t.repairPriorityNone}
          </div>
          <ul className="dialog-options" style={{ listStyle: 'none', padding: 0 }}>
            {damagedShips.map((s) => (
              <li key={s.key} className="dev-row">
                <span className="dev-key">{s.name}</span>
                <span>{t.repairShipDeficit} {Math.round(s.deficit)}</span>
                <button
                  className="dialog-option"
                  data-repair-focus={s.key}
                  onClick={() => setRepairPriority(hangar, s.key)}
                  disabled={desc.priorityShipKey === s.key}
                  style={{ marginLeft: 8 }}
                >
                  {t.repairFocusButton}
                </button>
              </li>
            ))}
          </ul>
          {desc.priorityShipKey && (
            <button
              className="dialog-option"
              data-repair-clear="1"
              onClick={() => setRepairPriority(hangar, '')}
            >
              {t.repairClearButton}
            </button>
          )}
        </>
      )}
    </>
  )
}

function setRepairPriority(hangar: Entity, shipKey: string): void {
  const cur = hangar.get(Hangar)
  if (!cur) return
  hangar.set(Hangar, { ...cur, repairPriorityShipKey: shipKey })
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

function sceneIdForBuilding(building: Entity): string | null {
  // The Hangar is in whatever scene world the dialog was opened from —
  // `world` is the active-scene proxy. Read the building's EntityKey
  // and reverse-lookup the scene id.
  const key = building.get(EntityKey)?.key
  if (!key) return null
  // EntityKey format set in spawn.ts is `bld-<sceneId>-<typeId>-<n>`.
  if (!key.startsWith('bld-')) return null
  const rest = key.slice(4)
  const dash = rest.indexOf('-')
  if (dash < 0) return null
  return rest.slice(0, dash)
}

function findShipByKey(key: string): Entity | null {
  // Ships live in playerShipInterior across every scene.
  const shipWorld = getWorld('playerShipInterior')
  for (const e of shipWorld.query(Ship, EntityKey)) {
    if (e.get(EntityKey)!.key === key) return e
  }
  return null
}

function shipDisplayName(templateId: string): string {
  try {
    return getShipClass(templateId).nameZh
  } catch {
    return templateId
  }
}
