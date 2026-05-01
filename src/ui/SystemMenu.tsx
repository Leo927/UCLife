import { useEffect, useState, useCallback } from 'react'
import { useDebug } from '../debug/store'
import { useUI } from './uiStore'
import { saveGame, loadGame, deleteSave, listSaves, MANUAL_SLOTS, type SlotId, type SaveMeta } from '../save'
import { formatUC } from '../sim/clock'

function slotLabel(slot: SlotId): string {
  if (slot === 'auto') return '自动存档'
  return `存档 ${slot}`
}

function formatRealTime(ms: number): string {
  const d = new Date(ms)
  const mo = (d.getMonth() + 1).toString().padStart(2, '0')
  const da = d.getDate().toString().padStart(2, '0')
  const hh = d.getHours().toString().padStart(2, '0')
  const mn = d.getMinutes().toString().padStart(2, '0')
  return `${mo}-${da} ${hh}:${mn}`
}

function formatMoney(n: number): string {
  return `¥${Math.round(n).toLocaleString('zh-CN')}`
}

function metaDescription(meta: SaveMeta): string {
  return [
    `第 ${meta.dayInGame} 天 · ${formatUC(meta.gameDate)}`,
    `${formatMoney(meta.playerMoney)} · HP ${meta.playerHp} · 在世 ${meta.alive}`,
    `保存于 ${formatRealTime(meta.savedAtRealMs)}`,
  ].join(' · ')
}

interface SlotRowProps {
  slot: SlotId
  meta: SaveMeta | undefined
  busy: boolean
  onSave?: () => void
  onLoad: () => void
  onDelete: () => void
}

function SlotRow({ slot, meta, busy, onSave, onLoad, onDelete }: SlotRowProps) {
  const empty = !meta
  const desc = empty
    ? (slot === 'auto' ? '尚无自动存档。日翻页和快进开始时自动写入。' : '空')
    : metaDescription(meta)
  return (
    <div className="debug-row">
      <span className="debug-row-label">{slotLabel(slot)}</span>
      <span className="debug-row-desc">{desc}</span>
      <span style={{ display: 'flex', gap: 6, gridColumn: 2, gridRow: '1 / span 2' }}>
        {onSave && <button className="debug-action" onClick={onSave} disabled={busy}>保存</button>}
        <button className="debug-action" onClick={onLoad} disabled={busy || empty}>读档</button>
        <button className="debug-action" onClick={onDelete} disabled={busy || empty}>删除</button>
      </span>
    </div>
  )
}

export function SystemMenu() {
  const open = useUI((s) => s.systemOpen)
  const setOpen = useUI((s) => s.setSystem)
  const playerAutoAI = useDebug((s) => s.playerAutoAI)
  const setPlayerAutoAI = useDebug((s) => s.setPlayerAutoAI)

  // Hooks must run unconditionally — keep them above the early return.
  const [metas, setMetas] = useState<Map<SlotId, SaveMeta>>(new Map())
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    const list = await listSaves()
    const next = new Map<SlotId, SaveMeta>()
    for (const m of list) next.set(m.slot, m)
    setMetas(next)
  }, [])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    refresh().then(() => { if (cancelled) return })
    return () => { cancelled = true }
  }, [open, refresh])

  if (!open) return null

  const close = () => setOpen(false)

  const onSave = (slot: 1 | 2 | 3) => async () => {
    if (busy) return
    setBusy(true)
    try {
      await saveGame(slot)
      useUI.getState().showToast(`已保存到${slotLabel(slot)}`)
      await refresh()
    } catch (e) {
      useUI.getState().showToast(`保存失败: ${(e as Error).message}`, 6000)
    } finally {
      setBusy(false)
    }
  }
  const onLoad = (slot: SlotId) => async () => {
    if (busy) return
    setBusy(true)
    try {
      const r = await loadGame(slot)
      if (r.ok) useUI.getState().showToast(`已读取${slotLabel(slot)}`)
      else useUI.getState().showToast(`读档失败: ${r.reason}`, 6000)
    } finally {
      setBusy(false)
    }
  }
  const onDelete = (slot: SlotId) => async () => {
    if (busy) return
    setBusy(true)
    try {
      await deleteSave(slot)
      useUI.getState().showToast(`${slotLabel(slot)}已删除`)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="status-overlay" onClick={close}>
      <div className="status-panel" onClick={(e) => e.stopPropagation()}>
        <header className="status-header">
          <h2>系统</h2>
          <button className="status-close" onClick={close} aria-label="关闭">✕</button>
        </header>
        <section className="status-section">
          <SlotRow
            slot="auto"
            meta={metas.get('auto')}
            busy={busy}
            onLoad={onLoad('auto')}
            onDelete={onDelete('auto')}
          />
          {MANUAL_SLOTS.map((slot) => (
            <SlotRow
              key={slot}
              slot={slot}
              meta={metas.get(slot)}
              busy={busy}
              onSave={onSave(slot)}
              onLoad={onLoad(slot)}
              onDelete={onDelete(slot)}
            />
          ))}
          <label className="debug-row">
            <span className="debug-row-label">玩家自动驾驶</span>
            <span className="debug-row-desc">让 AI 接管玩家：自动吃饭、喝水、睡觉等</span>
            <input
              className="debug-toggle"
              type="checkbox"
              checked={playerAutoAI}
              onChange={(e) => setPlayerAutoAI(e.target.checked)}
            />
          </label>
        </section>
      </div>
    </div>
  )
}
