// Toggleable event-log surface. The Phase 4 physiology UX leans on the
// event log heavily (symptom blurbs, daily digest, contagion lines), so
// the log finally has a DOM home. Toggled from a button in the bottom
// HUD; renders the most recent N entries from useEventLog.

import { useState } from 'react'
import { useEventLog } from './EventLog'
import { playUi } from '../audio/player'

export function EventLogPanel() {
  const [open, setOpen] = useState(false)
  const entries = useEventLog((s) => s.entries)

  if (!open) {
    return (
      <button
        type="button"
        className="event-log-toggle"
        onClick={() => { playUi('ui.event-log.open'); setOpen(true) }}
        title="打开日志"
        data-testid="event-log-toggle"
      >
        日志 ({entries.length})
      </button>
    )
  }

  // Show newest first.
  const reversed = [...entries].reverse()

  return (
    <div className="event-log-panel" data-testid="event-log-panel">
      <div className="event-log-panel-head">
        <span>事件日志</span>
        <button type="button" className="status-close" onClick={() => { playUi('ui.event-log.close'); setOpen(false) }} aria-label="关闭">✕</button>
      </div>
      {reversed.length === 0 ? (
        <div className="event-log-panel-empty">暂无记录。</div>
      ) : (
        <ul className="event-log-panel-list">
          {reversed.map((e) => (
            <li key={e.id}>{e.textZh}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
