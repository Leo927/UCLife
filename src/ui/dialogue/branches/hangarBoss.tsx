// W4.3b — on-ship hangar deck. The talk surface on the ship's hangar boss (a
// hired crew member stationed at the hangar bay). Diegetic sortie-side deck:
//   - the aboard-MS list with each unit's forward-repair state relative to
//     the on-ship band (systems/onShipRepair.ts :: describeOnShipRepair);
//   - a forward-repair-priority control (focus the pool on one aboard MS,
//     bounded by the band) — mirrors the depot RepairPriorityPanel but writes
//     Ship.onShipRepairPriorityKey;
//   - MS load / unload verbs (reusing msCustody.ts), surfaced only while the
//     ship is docked (deep work — refit, destroyed→ready, full restore —
//     stays at the surface depot).

import { useState, useEffect } from 'react'
import { useTrait } from 'koota/react'
import type { Entity } from 'koota'
import { Character, Ship, Ms, EmployedAsCrew, EntityKey } from '../../../ecs/traits'
import { getWorld } from '../../../ecs/world'
import { dialogueText } from '../../../data/dialogueText'
import { describeOnShipRepair } from '../../../systems/onShipRepair'
import {
  unloadMsToDepot, loadMsAboard, listShipAboardMsAtPoi, listDepotMsAtPoi,
  listShipsWithFreeBaysAtPoi, type CustodyMsRow, type CustodyShipRow,
} from '../../../systems/msCustody'
import { useUI } from '../../uiStore'
import type { DialogueCtx, DialogueNode } from '../types'

export function hangarBossBranch(ctx: DialogueCtx): DialogueNode | null {
  if (!ctx.roles.isHangarBossOnDuty) return null
  return {
    id: 'hangarBoss',
    label: dialogueText.buttons.hangarBoss,
    info: (ctx.npc.get(Character)?.name ?? '机库长') + dialogueText.branches.hangarBoss.titleSuffix,
    specialUI: () => <HangarBossPanel boss={ctx.npc} />,
  }
}

function shipByKey(key: string): Entity | null {
  const shipWorld = getWorld('playerShipInterior')
  for (const e of shipWorld.query(Ship, EntityKey)) {
    if (e.get(EntityKey)!.key === key) return e
  }
  return null
}

function HangarBossPanel({ boss }: { boss: Entity }) {
  const emp = useTrait(boss, EmployedAsCrew)
  const shipKey = emp?.shipKey ?? ''
  const ship = shipKey ? shipByKey(shipKey) : null
  // Re-render on repair ticks (off-trait hull mutation) + priority writes.
  const [, bump] = useState(0)
  useEffect(() => {
    const id = setInterval(() => bump((n) => n + 1), 500)
    return () => clearInterval(id)
  }, [])
  useTrait(ship, Ship)

  const t = dialogueText.branches.hangarBoss
  if (!ship) return <p className="hr-intro">{t.aboardEmpty}</p>

  const desc = describeOnShipRepair(ship)
  const s = ship.get(Ship)!
  const docked = s.dockedAtPoiId !== ''
  const priorityKey = s.onShipRepairPriorityKey

  const setPriority = (key: string) => {
    const cur = ship.get(Ship)
    if (!cur) return
    ship.set(Ship, { ...cur, onShipRepairPriorityKey: key })
    bump((n) => n + 1)
  }

  const priorityName = priorityKey
    ? desc.aboard.find((a) => a.key === priorityKey)?.name ?? priorityKey
    : null

  return (
    <>
      <h3>{(boss.get(Character)?.name ?? '机库长')}{t.titleSuffix}</h3>
      <div className="hr-intro">{t.intro}</div>
      <div className="hr-intro" data-onship-band>
        {t.bandFmt
          .replace('{floor}', String(Math.round(desc.floor * 100)))
          .replace('{cap}', String(Math.round(desc.cap * 100)))}
      </div>

      <h3 style={{ marginTop: 12 }}>{t.aboardHeader}</h3>
      {desc.aboard.length === 0 ? (
        <p className="hr-intro" data-onship-empty>{t.aboardEmpty}</p>
      ) : (
        <>
          <div className="hr-intro">
            {priorityName ? `${t.repairPriorityActive}${priorityName}` : t.repairPriorityNone}
          </div>
          <ul className="dialog-options" style={{ listStyle: 'none', padding: 0 }}>
            {desc.aboard.map((a) => (
              <li key={a.key} className="dev-row" data-onship-ms={a.key}>
                <span className="dev-key">{a.name}</span>
                <span data-onship-hull>
                  {t.hullLabel} {Math.round(a.armorPct * 100)}% / {Math.round(a.hullPct * 100)}%
                  {a.belowFloor ? t.sidelinedBadge : (a.atCap ? t.atCapBadge : '')}
                </span>
                <button
                  className="dialog-option"
                  data-onship-focus={a.key}
                  onClick={() => setPriority(a.key)}
                  disabled={a.belowFloor || priorityKey === a.key}
                  style={{ marginLeft: 8 }}
                >
                  {t.repairFocusButton}
                </button>
              </li>
            ))}
          </ul>
          {priorityKey && (
            <button className="dialog-option" data-onship-clear="1" onClick={() => setPriority('')}>
              {t.repairClearButton}
            </button>
          )}
        </>
      )}

      {docked ? (
        <>
          <MsUnloadPanel poiId={s.dockedAtPoiId} />
          <MsLoadPanel poiId={s.dockedAtPoiId} />
        </>
      ) : (
        <p className="hr-intro" data-onship-docked-only>{t.dockedOnlyHint}</p>
      )}
    </>
  )
}

// Reuse the generic MS-custody labels from the depot hangar manager — the
// verbs (unloadMsToDepot / loadMsAboard) and their copy are hull-agnostic.
function MsUnloadPanel({ poiId }: { poiId: string }) {
  const t = dialogueText.branches.hangarManager
  const showToast = useUI((st) => st.showToast)
  const [, bump] = useState(0)
  const aboard = listShipAboardMsAtPoi(poiId)

  const onUnload = (ms: CustodyMsRow) => {
    const r = unloadMsToDepot(ms.msKey, poiId)
    if (!r.ok) { showToast(r.reasonZh); return }
    showToast(t.msUnloadToastDone.replace('{ms}', ms.msName))
    bump((n) => n + 1)
  }

  return (
    <section style={{ marginTop: 12 }} data-onship-unload>
      <h3>{t.msUnloadHeader}</h3>
      <div className="hr-intro">{t.msUnloadIntro}</div>
      {aboard.length === 0 ? (
        <p className="hr-intro" data-onship-unload-empty>{t.msUnloadEmpty}</p>
      ) : (
        <ul className="dialog-options" style={{ listStyle: 'none', padding: 0 }}>
          {aboard.map((ms) => (
            <li key={ms.msKey} className="dev-row" data-onship-unload-row={ms.msKey}>
              <span className="dev-key">{ms.msName}</span>
              <button
                className="dialog-option"
                data-onship-unload-confirm={ms.msKey}
                onClick={() => onUnload(ms)}
              >
                {t.msUnloadConfirmButton}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function MsLoadPanel({ poiId }: { poiId: string }) {
  const t = dialogueText.branches.hangarManager
  const showToast = useUI((st) => st.showToast)
  const [, bump] = useState(0)
  const depotMs = listDepotMsAtPoi(poiId)
  const [pickedMsKey, setPickedMsKey] = useState<string | null>(null)
  const pickedMs = pickedMsKey ? depotMs.find((m) => m.msKey === pickedMsKey) ?? null : null
  const ships = pickedMsKey ? listShipsWithFreeBaysAtPoi(poiId) : []

  const onLoad = (ship: CustodyShipRow) => {
    if (!pickedMsKey || !pickedMs) return
    const r = loadMsAboard(pickedMsKey, ship.shipKey)
    if (!r.ok) { showToast(r.reasonZh); return }
    showToast(t.msLoadToastDone.replace('{ms}', pickedMs.msName).replace('{ship}', ship.shipName))
    setPickedMsKey(null)
    bump((n) => n + 1)
  }

  return (
    <section style={{ marginTop: 12 }} data-onship-load>
      <h3>{t.msLoadHeader}</h3>
      <div className="hr-intro">{t.msLoadIntro}</div>
      {depotMs.length === 0 ? (
        <p className="hr-intro" data-onship-load-empty>{t.msLoadEmpty}</p>
      ) : pickedMsKey === null ? (
        <ul className="dialog-options" style={{ listStyle: 'none', padding: 0 }}>
          <li className="dev-row"><span className="dev-key">{t.msLoadPickMsLabel}</span></li>
          {depotMs.map((ms) => (
            <li key={ms.msKey} className="dev-row" data-onship-load-ms={ms.msKey}>
              <span className="dev-key">{ms.msName}</span>
              <button
                className="dialog-option"
                data-onship-load-pick={ms.msKey}
                onClick={() => setPickedMsKey(ms.msKey)}
              >
                {t.msLoadPickShipLabel}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="dialog-options" style={{ listStyle: 'none', padding: 0 }}>
          <li className="dev-row">
            <span className="dev-key">{pickedMs?.msName}</span>
            <button className="dialog-option" data-onship-load-back="1" onClick={() => setPickedMsKey(null)}>
              {t.msLoadBack}
            </button>
          </li>
          {ships.length === 0 ? (
            <li className="dev-row" data-onship-load-no-ship>
              <span className="dev-key">{t.msLoadEmpty}</span>
            </li>
          ) : ships.map((ship) => (
            <li key={ship.shipKey} className="dev-row" data-onship-load-ship={ship.shipKey}>
              <span className="dev-key">{ship.shipName}</span>
              <span>{ship.freeBays} / {ship.hangarCapacity}</span>
              <button
                className="dialog-option"
                data-onship-load-confirm={ship.shipKey}
                onClick={() => onLoad(ship)}
              >
                {t.msLoadConfirmButton}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// Silence unused-import lint for the Ms trait referenced indirectly via the
// msCustody helpers (re-exported through ecs/traits index).
void Ms
