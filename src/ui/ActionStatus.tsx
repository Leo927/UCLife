import { useQueryFirst, useTrait } from 'koota/react'
import { IsPlayer, Action, Job, JobPerformance, Workstation } from '../ecs/traits'
import { actionLabel } from '../data/actions'
import { getJobSpec } from '../data/jobs'
import { playUi } from '../audio/player'

export function ActionStatus() {
  const player = useQueryFirst(IsPlayer, Action)
  const action = useTrait(player, Action)
  const job = useTrait(player, Job)
  const perf = useTrait(player, JobPerformance)
  if (!player || !action) return null
  if (action.kind === 'idle' || action.kind === 'walking') return null

  const cancel = () => {
    playUi('ui.action.cancel')
    player.set(Action, { kind: 'idle', remaining: 0, total: 0 })
  }

  if (action.kind === 'working') {
    const ws = job?.workstation?.get(Workstation) ?? null
    const spec = ws ? getJobSpec(ws.specId) : null
    const p = Math.round(perf?.todayPerf ?? 0)
    return (
      <div className="action-status">
        <span className="action-label">{actionLabel(action.kind)}</span>
        <div className="action-bar">
          <div className="action-fill" style={{ width: `${p}%` }} />
        </div>
        <span className="action-time">
          绩效 {p}%{spec ? ` · 下班 ${spec.shiftEnd}:00` : ''}
        </span>
        <button className="action-cancel" onClick={cancel}>下班</button>
      </div>
    )
  }

  const elapsed = Math.max(0, action.total - action.remaining)
  const pct = action.total > 0 ? (elapsed / action.total) * 100 : 0

  return (
    <div className="action-status">
      <span className="action-label">{actionLabel(action.kind)}</span>
      <div className="action-bar">
        <div className="action-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="action-time">
        {formatHours(elapsed)} / {formatHours(action.total)}
      </span>
      <button className="action-cancel" onClick={cancel}>中断</button>
    </div>
  )
}

function formatHours(min: number): string {
  const h = Math.floor(min / 60)
  const m = Math.floor(min % 60)
  if (h > 0) return `${h}时${m.toString().padStart(2, '0')}分`
  return `${m}分钟`
}
