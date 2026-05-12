// Phase 6.2.E1 — war-room plot table on the flagship bridge.
//
// Composition verb surface per Design/fleet.md. Renders the player's
// owned fleet as click-to-pick tokens against an active-grid +
// reserve-tray layout, plus a per-ship aggression slider.
//
// Diegesis: opened by walking onto the 'warRoom' interactable in the
// flagship's bridge (or, on the Pegasus class, the dedicated warRoom
// room). Closes back to the walkable scene without committing to any
// action. Per Design/fleet.md "war-room mechanics" — this is the only
// place fleet composition is set; the fleet roster shows the state
// read-only.
//
// Interaction model: click-to-pick. The player selects a ship token
// (either from the reserve tray or the active grid), then clicks an
// empty slot to place it. Clicking the same token deselects. Clicking
// the reserve tray with a token selected demotes the ship. The flagship
// token is rendered fixed at its anchor slot and rejects all clicks
// (it can't be moved out of the active fleet — that's the design
// invariant). HTML5 drag-and-drop would be roughly equivalent UX but
// smoke drives via __uclife__ debug handles regardless, so the simpler
// click model wins.

import { useState } from 'react'
import { Ship } from '../ecs/traits'
import { useUI } from './uiStore'
import { useScene } from '../sim/scene'
import { playUi } from '../audio/player'
import { fleetConfig } from '../config'
import { dialogueText } from '../data/dialogueText'
import {
  warRoomDescribe,
  setIsInActiveFleet,
  setFormationSlot,
  setAggression,
} from '../systems/fleetWarRoom'

const SHIP_SCENE_ID = 'playerShipInterior'

export function WarRoomPanel() {
  const open = useUI((s) => s.warRoomOpen)
  const close = useUI((s) => s.setWarRoom)
  const showToast = useUI((s) => s.showToast)
  const activeId = useScene((s) => s.activeId)
  // Tick state forces a re-read of the war-room snapshot after each
  // mutating action — the ECS doesn't drive React updates on Ship
  // trait writes / IsInActiveFleet marker flips otherwise.
  const [tick, setTick] = useState(0)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  // Hook ordering: derive open-state booleans only AFTER state hooks
  // so the panel renders for the same key set every frame. Early-return
  // happens below.
  void Ship
  void tick

  if (!open) return null
  if (activeId !== SHIP_SCENE_ID) return null

  const t = dialogueText.branches.warRoom
  const snap = warRoomDescribe()
  const grid = fleetConfig.activeFleetGrid

  const bump = () => setTick((n) => n + 1)

  const onClose = () => {
    playUi('ui.npc.close')
    setSelectedKey(null)
    close(false)
  }

  const onClickToken = (shipKey: string, isFlagship: boolean) => {
    if (isFlagship) {
      showToast(t.toastFlagshipLocked)
      return
    }
    setSelectedKey((cur) => (cur === shipKey ? null : shipKey))
  }

  const onClickSlot = (slot: number) => {
    if (!selectedKey) return
    if (slot === grid.flagshipSlot) {
      showToast(t.toastFlagshipLocked)
      return
    }
    const row = snap.ships.find((s) => s.entityKey === selectedKey)
    if (!row) { setSelectedKey(null); return }
    const r = row.isInActiveFleet
      ? setFormationSlot(selectedKey, slot)
      : setIsInActiveFleet(selectedKey, true, slot)
    if (!r.ok) {
      showToast(t.toastMoveFailed.replace('{reason}', r.reason))
      return
    }
    playUi('ui.hr.accept')
    setSelectedKey(null)
    bump()
  }

  const onClickReserveDrop = () => {
    if (!selectedKey) return
    const row = snap.ships.find((s) => s.entityKey === selectedKey)
    if (!row) { setSelectedKey(null); return }
    if (row.isFlagship) {
      showToast(t.toastFlagshipLocked)
      return
    }
    const r = setIsInActiveFleet(selectedKey, false)
    if (!r.ok) {
      showToast(t.toastMoveFailed.replace('{reason}', r.reason))
      return
    }
    playUi('ui.hr.accept')
    setSelectedKey(null)
    bump()
  }

  const onPickAggression = (shipKey: string, level: string) => {
    const r = setAggression(shipKey, level)
    if (!r.ok) {
      showToast(t.toastMoveFailed.replace('{reason}', r.reason))
      return
    }
    playUi('ui.hr.accept')
    bump()
  }

  const reserveShips = snap.ships.filter((s) => !s.isInActiveFleet)
  const totalSlots = grid.cols * grid.rows

  return (
    <div className="status-overlay" onClick={onClose} data-war-room-overlay>
      <div className="status-panel" onClick={(e) => e.stopPropagation()} data-war-room>
        <header className="status-header">
          <h2>{t.title}</h2>
          <button className="status-close" onClick={onClose} aria-label="关闭">✕</button>
        </header>
        <section className="status-section">
          <p className="hr-intro">{t.intro}</p>
        </section>
        <section className="status-section">
          <h3>{t.activeGridHeader}</h3>
          <div
            className="war-room-grid"
            data-war-room-grid
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${grid.cols}, minmax(7em, 1fr))`,
              gap: '0.4em',
            }}
          >
            {Array.from({ length: totalSlots }, (_, slot) => {
              const occKey = snap.occupancy[slot] ?? null
              const occRow = occKey ? snap.ships.find((s) => s.entityKey === occKey) ?? null : null
              return (
                <SlotCell
                  key={slot}
                  slot={slot}
                  isFlagshipSlot={slot === grid.flagshipSlot}
                  row={occRow}
                  selectedKey={selectedKey}
                  onClickSlot={onClickSlot}
                  onClickToken={onClickToken}
                  emptyLabel={t.emptySlotLabel}
                  flagshipBadge={t.flagshipBadge}
                />
              )
            })}
          </div>
        </section>
        <section className="status-section">
          <h3>{t.reserveTrayHeader}</h3>
          <div
            className="war-room-reserve"
            data-war-room-reserve
            onClick={onClickReserveDrop}
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0.4em',
              minHeight: '3em',
              padding: '0.5em',
              border: '1px dashed #525252',
              cursor: selectedKey ? 'pointer' : 'default',
            }}
          >
            {reserveShips.length === 0 ? (
              <span className="hr-intro" style={{ opacity: 0.6 }}>{t.reserveEmpty}</span>
            ) : (
              reserveShips.map((row) => (
                <ShipToken
                  key={row.entityKey}
                  row={row}
                  selected={selectedKey === row.entityKey}
                  onClick={() => onClickToken(row.entityKey, row.isFlagship)}
                />
              ))
            )}
          </div>
        </section>
        <section className="status-section">
          <h3>{t.aggressionHeader}</h3>
          <ul className="dialog-options" style={{ listStyle: 'none', padding: 0 }}>
            {snap.ships.map((row) => (
              <li
                key={row.entityKey}
                className="dev-row"
                data-war-room-aggression-row={row.entityKey}
                style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.4em' }}
              >
                <span className="dev-key" style={{ flex: '1 0 8em' }}>
                  {row.shipName}
                  {row.isFlagship && (
                    <span style={{ marginLeft: 4, opacity: 0.7 }}>· {t.flagshipBadge}</span>
                  )}
                </span>
                <span style={{ flex: '0 0 auto', opacity: 0.7 }}>
                  {row.isInActiveFleet ? t.stateActive : t.stateReserve}
                </span>
                <span style={{ display: 'inline-flex', gap: '0.25em' }}>
                  {fleetConfig.aggressionLevels.map((lvl) => (
                    <button
                      key={lvl.id}
                      className="dialog-option"
                      data-war-room-aggression={`${row.entityKey}:${lvl.id}`}
                      aria-pressed={row.aggression === lvl.id}
                      style={{
                        opacity: row.aggression === lvl.id ? 1 : 0.55,
                      }}
                      onClick={() => onPickAggression(row.entityKey, lvl.id)}
                    >
                      {lvl.labelZh}
                    </button>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section className="status-section">
          <div className="dialog-options">
            <button className="dialog-option" onClick={onClose}>{dialogueText.buttons.back}</button>
          </div>
        </section>
      </div>
    </div>
  )
}

function SlotCell(props: {
  slot: number
  isFlagshipSlot: boolean
  row: ReturnType<typeof warRoomDescribe>['ships'][number] | null
  selectedKey: string | null
  onClickSlot: (slot: number) => void
  onClickToken: (key: string, isFlagship: boolean) => void
  emptyLabel: string
  flagshipBadge: string
}) {
  const { slot, isFlagshipSlot, row, selectedKey, onClickSlot, onClickToken, emptyLabel, flagshipBadge } = props
  const occupied = !!row
  const isSelected = !!row && row.entityKey === selectedKey
  const onClick = () => {
    if (row) onClickToken(row.entityKey, row.isFlagship)
    else onClickSlot(slot)
  }
  return (
    <button
      data-war-room-slot={slot}
      data-war-room-slot-occupant={row?.entityKey ?? ''}
      data-war-room-slot-flagship={isFlagshipSlot ? '1' : '0'}
      className="dialog-option"
      style={{
        minHeight: '3.5em',
        opacity: occupied ? (isSelected ? 1 : 0.85) : 0.45,
        border: isSelected ? '2px solid #fcd34d' : '1px solid #525252',
        background: isFlagshipSlot ? '#1e1b4b' : undefined,
      }}
      onClick={onClick}
    >
      {row ? (
        <span>
          {row.shipName}
          {row.isFlagship && (
            <span style={{ marginLeft: 4, opacity: 0.8 }}>· {flagshipBadge}</span>
          )}
        </span>
      ) : (
        <span style={{ opacity: 0.65 }}>{emptyLabel}</span>
      )}
    </button>
  )
}

function ShipToken(props: {
  row: ReturnType<typeof warRoomDescribe>['ships'][number]
  selected: boolean
  onClick: () => void
}) {
  const { row, selected, onClick } = props
  return (
    <button
      data-war-room-token={row.entityKey}
      className="dialog-option"
      style={{
        opacity: selected ? 1 : 0.85,
        border: selected ? '2px solid #fcd34d' : '1px solid #525252',
      }}
      onClick={(e) => { e.stopPropagation(); onClick() }}
    >
      {row.shipName}
    </button>
  )
}
