import { useState } from 'react'
import { useQueryFirst } from 'koota/react'
import { IsPlayerFaction, FactionSheet } from '../../../ecs/traits'
import { callCouncil, resolveCouncil, type AttendeeView, type CouncilSession } from '../../../systems/governance'
import { getAllColonyRecords } from '../../../sim/colony'
import { governanceConfig, type PolicyKind } from '../../../config/governance'
import { gameDayNumber, useClock } from '../../../sim/clock'
import type { DialogueCtx, DialogueNode } from '../types'

export function councilChamberBranch(ctx: DialogueCtx): DialogueNode | null {
  if (!ctx.roles.isPlayerFactionLeader) return null
  return {
    id: 'council-chamber',
    label: '召开议政会',
    hint: '就内部政策召集高级幕僚讨论',
    info: '议政会 · 选择议题，听取意见，作出决策。',
    specialUI: () => <CouncilChamberPanel />,
  }
}

type PolicyPhase = 'pick-policy' | 'debate' | 'resolved'

function CouncilChamberPanel() {
  const pf = useQueryFirst(IsPlayerFaction) ?? null

  const [phase, setPhase] = useState<PolicyPhase>('pick-policy')
  const [session, setSession] = useState<CouncilSession | null>(null)
  const [reply, setReply] = useState<string | null>(null)

  const factionOk = pf !== null && pf.has(FactionSheet)
  const colonies = getAllColonyRecords()

  if (!factionOk || colonies.length === 0) {
    return (
      <div>
        <p className="dialog-response">尚未建立可调用议政会的殖民地势力。</p>
      </div>
    )
  }

  const openDebate = (poiId: string, policyKind: PolicyKind) => {
    const s = callCouncil(poiId, policyKind)
    if (!s || s.attendees.length === 0) {
      setReply('该殖民地尚无分配幕僚 · 先指派管理官、首席工程师或守备指挥官。')
      return
    }
    setSession(s)
    setPhase('debate')
    setReply(null)
  }

  const resolve = (newValue: string) => {
    if (!session) return
    const gameDay = gameDayNumber(useClock.getState().gameDate)
    resolveCouncil(session, newValue, gameDay)
    const cfg = governanceConfig.policies[session.policyKind]
    setReply(`已裁定：${cfg.labelZh} → ${newValue}`)
    setPhase('resolved')
  }

  if (phase === 'pick-policy') {
    return (
      <div>
        {reply && <p className="dialog-response">{reply}</p>}
        <p className="hr-intro">选择殖民地与议题：</p>
        {colonies.map((rec) => (
          <div key={rec.poiId} style={{ marginBottom: 8 }}>
            <strong style={{ fontSize: '0.85em', opacity: 0.7 }}>{rec.poiId}</strong>
            <div className="dialog-options">
              <button
                className="dialog-option"
                data-verb="council-taxation"
                onClick={() => openDebate(rec.poiId, 'taxation')}
              >
                税率政策
              </button>
              <button
                className="dialog-option"
                data-verb="council-alignment"
                onClick={() => openDebate(rec.poiId, 'alignment')}
              >
                政治立场
              </button>
              <button
                className="dialog-option"
                data-verb="council-trade"
                onClick={() => openDebate(rec.poiId, 'tradePriority')}
              >
                贸易重心
              </button>
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (phase === 'debate' && session) {
    const cfg = governanceConfig.policies[session.policyKind]
    return (
      <div>
        <h3>{cfg.labelZh}议题 · 当前值：{session.currentValue}</h3>
        <p className="hr-intro">与会者意见：</p>
        <AttendeeList attendees={session.attendees} />
        <p className="hr-intro" style={{ marginTop: 10 }}>请作出裁定：</p>
        <div className="dialog-options">
          {cfg.options.map((opt) => (
            <button
              key={String(opt)}
              className="dialog-option"
              data-verb={`council-resolve-${opt}`}
              onClick={() => resolve(String(opt))}
            >
              {cfg.labelZh} → {String(opt)}
            </button>
          ))}
          <button
            className="dialog-option"
            onClick={() => { setPhase('pick-policy'); setSession(null) }}
          >
            取消，不作变更
          </button>
        </div>
      </div>
    )
  }

  return (
    <div>
      {reply && <p className="dialog-response">{reply}</p>}
      <div className="dialog-options">
        <button
          className="dialog-option"
          onClick={() => { setPhase('pick-policy'); setSession(null); setReply(null) }}
        >
          重新讨论其他政策
        </button>
      </div>
    </div>
  )
}

function AttendeeList({ attendees }: { attendees: AttendeeView[] }) {
  const STANCE_LABEL: Record<string, string> = {
    support: '赞成',
    oppose: '反对',
    neutral: '中立',
  }
  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {attendees.map((a) => (
        <li key={a.npcKey} style={{ marginBottom: 6 }}>
          <strong>{a.nameZh}</strong>
          <span style={{ marginLeft: 6, opacity: 0.6 }}>{a.roleZh}</span>
          <span style={{ marginLeft: 10 }}>
            [{STANCE_LABEL[a.stance] ?? a.stance}]
          </span>
          <span style={{ marginLeft: 8, fontStyle: 'italic', opacity: 0.8 }}>
            {a.argumentZh}
          </span>
        </li>
      ))}
    </ul>
  )
}
