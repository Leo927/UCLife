import { useState } from 'react'
import { useQueryFirst } from 'koota/react'
import { IsPlayerFaction, FactionSheet } from '../../../ecs/traits'
import {
  conveneDiplomacyCouncil, signTreaty, declineTreaty, diplomacyCanonFactions,
  type DiplomacyAttendeeView, type DiplomacyCouncilSession,
} from '../../../systems/diplomacy'
import { getAllColonyRecords } from '../../../sim/colony'
import { factionMeta } from '../../../data/factions'
import { factionsConfig, type FactionId, type TreatyType } from '../../../config'
import { gameDayNumber, useClock } from '../../../sim/clock'
import type { DialogueCtx, DialogueNode } from '../types'

export function diplomacyCouncilBranch(ctx: DialogueCtx): DialogueNode | null {
  if (!ctx.roles.isPlayerFactionLeader) return null
  return {
    id: 'diplomacy-council',
    label: '召开外交议事',
    hint: '与各方势力商议条约',
    info: '外交议事 · 选择对象与条约，听取幕僚意见，签署或回绝。',
    specialUI: () => <DiplomacyCouncilPanel />,
  }
}

type DiplomacyPhase = 'pick' | 'debate' | 'resolved'

const TREATY_TYPES = Object.keys(factionsConfig.diplomacy.treaties) as TreatyType[]

function DiplomacyCouncilPanel() {
  const pf = useQueryFirst(IsPlayerFaction) ?? null

  const [phase, setPhase] = useState<DiplomacyPhase>('pick')
  const [session, setSession] = useState<DiplomacyCouncilSession | null>(null)
  const [reply, setReply] = useState<string | null>(null)

  const factionOk = pf !== null && pf.has(FactionSheet)
  const colonies = getAllColonyRecords()

  if (!factionOk || colonies.length === 0) {
    return (
      <div>
        <p className="dialog-response">尚未建立可召开外交议事的殖民地势力。</p>
      </div>
    )
  }

  const openDebate = (poiId: string, factionId: FactionId, treatyType: TreatyType) => {
    const s = conveneDiplomacyCouncil(poiId, factionId, treatyType)
    if (!s || s.attendees.length === 0) {
      setReply('该殖民地尚无分配幕僚 · 先指派管理官、首席工程师或守备指挥官。')
      return
    }
    setSession(s)
    setPhase('debate')
    setReply(null)
  }

  const sign = () => {
    if (!session) return
    const gameDay = gameDayNumber(useClock.getState().gameDate)
    signTreaty(session, gameDay)
    const spec = factionsConfig.diplomacy.treaties[session.treatyType]
    setReply(`已签署：${factionMeta(session.factionId).shortZh} · ${spec.labelZh}`)
    setPhase('resolved')
  }

  const decline = () => {
    if (!session) return
    declineTreaty(session)
    setReply('已回绝该项条约。')
    setPhase('resolved')
  }

  if (phase === 'pick') {
    const colony = colonies[0]
    return (
      <div>
        {reply && <p className="dialog-response">{reply}</p>}
        <p className="hr-intro">选择对象势力与条约类型：</p>
        {diplomacyCanonFactions().map((fid) => (
          <div key={fid} style={{ marginBottom: 8 }}>
            <strong style={{ fontSize: '0.85em', opacity: 0.7 }}>{factionMeta(fid).nameZh}</strong>
            <div className="dialog-options">
              {TREATY_TYPES.map((t) => (
                <button
                  key={t}
                  className="dialog-option"
                  data-verb={`diplomacy-${fid}-${t}`}
                  onClick={() => openDebate(colony.poiId, fid, t)}
                >
                  {factionsConfig.diplomacy.treaties[t].labelZh}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (phase === 'debate' && session) {
    const spec = factionsConfig.diplomacy.treaties[session.treatyType]
    return (
      <div>
        <h3>{factionMeta(session.factionId).shortZh} · {spec.labelZh}</h3>
        <p className="hr-intro">与会者意见：</p>
        <AttendeeList attendees={session.attendees} />
        <p className="hr-intro" style={{ marginTop: 10 }}>请作出裁定：</p>
        <div className="dialog-options">
          <button className="dialog-option" data-verb="diplomacy-sign" onClick={sign}>
            签署条约
          </button>
          <button className="dialog-option" data-verb="diplomacy-decline" onClick={decline}>
            回绝
          </button>
          <button
            className="dialog-option"
            onClick={() => { setPhase('pick'); setSession(null) }}
          >
            返回
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
          onClick={() => { setPhase('pick'); setSession(null); setReply(null) }}
        >
          继续商议其他条约
        </button>
      </div>
    </div>
  )
}

function AttendeeList({ attendees }: { attendees: DiplomacyAttendeeView[] }) {
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
          <span style={{ marginLeft: 10 }}>[{STANCE_LABEL[a.stance] ?? a.stance}]</span>
          <span style={{ marginLeft: 8, fontStyle: 'italic', opacity: 0.8 }}>{a.argumentZh}</span>
        </li>
      ))}
    </ul>
  )
}
