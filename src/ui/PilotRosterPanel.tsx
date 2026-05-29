// Issue #65 — pilot roster notebook surface. Opened from a button inside
// the captain's-office briefing panel (the diegetic home for fleet-tier
// admin, alongside the fleet roster); standalone modal listing every
// pilot in the fleet's pool with name, piloting level, current MS
// assignment, and state (idle / assigned / damaged). One-click reassign
// writes the same Ms.pilotId + EmployedAsPilot trait the receive-MS
// auto-assign already writes, routed through systems/msPilotAssign so the
// two stay consistent (Design/fleet.md top-risk #3).
//
// Read-mostly: the roster view is rebuilt once per open (modal, not
// per-tick), O(P) over the pilot pool — see the perf note in Issue #65.

import { useState } from 'react'
import { Character, EmployedAsPilot, EntityKey, Ms } from '../ecs/traits'
import { getWorld, SCENE_IDS } from '../ecs/world'
import { getMsClass } from '../data/ms'
import { getSkillXp, levelOf } from '../character/skills'
import { assignPilotToMs } from '../systems/msPilotAssign'
import { useUI } from './uiStore'
import { dialogueText } from '../data/dialogueText'
import { playUi } from '../audio/player'

const SHIP_SCENE_ID = 'playerShipInterior'

type PilotState = 'idle' | 'assigned' | 'damaged'

interface PilotRow {
  npcKey: string
  name: string
  pilotingLevel: number
  msKey: string
  msName: string
  state: PilotState
}

interface MsTarget {
  msKey: string
  label: string
}

function msDisplayName(msKey: string): { name: string; damaged: boolean } | null {
  if (!msKey) return null
  const w = getWorld(SHIP_SCENE_ID)
  for (const e of w.query(Ms, EntityKey)) {
    if (e.get(EntityKey)!.key !== msKey) continue
    const ms = e.get(Ms)!
    const name = ms.name || getMsClass(ms.templateId).nameZh
    const damaged = ms.hullCurrent < ms.hullMax || ms.armorCurrent < ms.armorMax
    return { name, damaged }
  }
  return null
}

function collectPilotRoster(): PilotRow[] {
  const out: PilotRow[] = []
  for (const sceneId of SCENE_IDS) {
    const w = getWorld(sceneId)
    for (const npc of w.query(Character, EmployedAsPilot, EntityKey)) {
      const msKey = npc.get(EmployedAsPilot)!.msKey
      const ms = msDisplayName(msKey)
      const state: PilotState = msKey === '' ? 'idle' : ms?.damaged ? 'damaged' : 'assigned'
      out.push({
        npcKey: npc.get(EntityKey)!.key,
        name: npc.get(Character)!.name,
        pilotingLevel: levelOf(getSkillXp(npc, 'piloting')),
        msKey,
        msName: ms?.name ?? '',
        state,
      })
    }
  }
  // Best-first then stable so the roster ordering is deterministic.
  out.sort((a, b) => {
    if (b.pilotingLevel !== a.pilotingLevel) return b.pilotingLevel - a.pilotingLevel
    return a.npcKey.localeCompare(b.npcKey)
  })
  return out
}

function collectMsTargets(): MsTarget[] {
  const out: MsTarget[] = []
  const w = getWorld(SHIP_SCENE_ID)
  for (const e of w.query(Ms, EntityKey)) {
    const ms = e.get(Ms)!
    out.push({
      msKey: e.get(EntityKey)!.key,
      label: ms.name || getMsClass(ms.templateId).nameZh,
    })
  }
  return out
}

export function PilotRosterPanel() {
  const open = useUI((s) => s.pilotRosterOpen)
  const setOpen = useUI((s) => s.setPilotRoster)
  // Tick state lets a reassign force a re-render of the roster without
  // remounting the modal (same pattern as FleetRosterPanel).
  const [tick, setTick] = useState(0)
  const bump = () => setTick((n) => n + 1)

  if (!open) return null

  const t = dialogueText.branches.pilotRoster
  const rows = collectPilotRoster()
  const targets = collectMsTargets()
  void tick

  const close = () => {
    playUi('ui.npc.close')
    setOpen(false)
  }

  return (
    <div className="status-overlay" onClick={close}>
      <div className="status-panel" onClick={(e) => e.stopPropagation()} data-pilot-roster>
        <header className="status-header">
          <h2>{t.title}</h2>
          <button className="status-close" onClick={close} aria-label="关闭">✕</button>
        </header>
        <section className="status-section">
          {rows.length === 0 ? (
            <p className="hr-intro">{t.empty}</p>
          ) : (
            <ul className="dialog-options" style={{ listStyle: 'none', padding: 0 }}>
              {rows.map((r) => (
                <PilotRowItem key={r.npcKey} row={r} targets={targets} onMutate={bump} />
              ))}
            </ul>
          )}
        </section>
        <section className="status-section">
          <div className="dialog-options">
            <button className="dialog-option" onClick={close}>{dialogueText.buttons.back}</button>
          </div>
        </section>
      </div>
    </div>
  )
}

function PilotRowItem({
  row, targets, onMutate,
}: { row: PilotRow; targets: MsTarget[]; onMutate: () => void }) {
  const t = dialogueText.branches.pilotRoster
  const [picking, setPicking] = useState(false)

  const stateLabel = row.state === 'idle'
    ? t.stateIdle
    : row.state === 'damaged'
      ? t.stateDamaged
      : t.stateAssigned

  const onPick = (msKey: string) => {
    if (assignPilotToMs(row.npcKey, msKey)) playUi('ui.hr.accept')
    setPicking(false)
    onMutate()
  }

  return (
    <li
      className="dev-row"
      data-pilot-row={row.npcKey}
      data-pilot-state={row.state}
      style={{ flexWrap: 'wrap', alignItems: 'center', gap: '0.5em' }}
    >
      <span className="dev-key" style={{ minWidth: 0, flex: '1 0 8em' }}>{row.name}</span>
      <span style={{ flex: '0 0 auto' }}>{t.colPiloting} {row.pilotingLevel}</span>
      <span data-pilot-assignment style={{ flex: '1 0 8em' }}>
        {t.colAssignment}: {row.msKey ? (row.msName || row.msKey) : t.stateIdle}
      </span>
      <span data-pilot-state-label style={{ flex: '0 0 auto' }}>{stateLabel}</span>
      {!picking ? (
        <button
          className="dialog-option"
          data-pilot-reassign={row.npcKey}
          disabled={targets.length === 0}
          onClick={() => setPicking(true)}
        >
          {t.reassignButton}
        </button>
      ) : (
        <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: '0.25em' }}>
          {targets.map((m) => (
            <button
              key={m.msKey}
              className="dialog-option"
              data-pilot-reassign-pick={`${row.npcKey}->${m.msKey}`}
              disabled={m.msKey === row.msKey}
              onClick={() => onPick(m.msKey)}
            >
              {m.label}
            </button>
          ))}
          <button
            className="dialog-option"
            data-pilot-reassign-cancel={row.npcKey}
            onClick={() => setPicking(false)}
          >
            {dialogueText.buttons.back}
          </button>
        </span>
      )}
    </li>
  )
}
