import { useQuery, useQueryFirst, useTrait } from 'koota/react'
import type { Entity } from 'koota'
import {
  IsPlayer, Skills, Job, Workstation, Position, Reputation,
  FactionRole, Knows, JobTenure, Character,
} from '../../ecs/traits'
import { useUI } from '../uiStore'
import { SKILLS, levelOf, type SkillId } from '../../character/skills'
import { getJobSpec } from '../../data/jobs'
import type { JobSpec } from '../../config'
import { jobsConfig, factionsConfig } from '../../config'
import { clearPromotionNoticeForFamily } from '../../systems/promotion'

interface RankRow {
  specId: string
  spec: JobSpec
  // null = every station for this spec is filled by another NPC.
  ws: Entity | null
  isCurrent: boolean
  // Empty = all gates met.
  missing: string[]
}

export function AEConversation() {
  const player = useQueryFirst(IsPlayer, Skills, Job)
  const skills = useTrait(player, Skills)
  const job = useTrait(player, Job)
  const reputation = useTrait(player, Reputation)
  const tenure = useTrait(player, JobTenure)
  const allStations = useQuery(Workstation, Position)
  const factionRoles = useQuery(FactionRole)

  if (!player || !skills) return null

  const aeRep = reputation?.rep.anaheim ?? 0
  const aeMeta = factionsConfig.catalog.anaheim

  const currentSpec = (() => {
    const ws = job?.workstation
    if (!ws) return null
    const w = ws.get(Workstation)
    return w ? getJobSpec(w.specId) : null
  })()
  const currentRankSpecId = currentSpec?.family === 'anaheim_engineering'
    ? job?.workstation?.get(Workstation)?.specId ?? null
    : null

  let bestBoardOpinion = -Infinity
  let bestBoardName: string | null = null
  for (const e of factionRoles) {
    const fr = e.get(FactionRole)!
    if (fr.faction !== 'anaheim' || fr.role !== 'board') continue
    const edge = player.has(Knows(e)) ? player.get(Knows(e)) : null
    const op = edge?.opinion ?? 0
    if (op > bestBoardOpinion) {
      bestBoardOpinion = op
      const ch = e.get(Character)
      bestBoardName = ch?.name ?? null
    }
  }

  const rows: RankRow[] = []
  for (const [specId, spec] of Object.entries(jobsConfig.catalog)) {
    if (spec.family !== 'anaheim_engineering' || typeof spec.rank !== 'number') continue

    let ws: Entity | null = null
    for (const e of allStations) {
      const w = e.get(Workstation)!
      if (w.specId !== specId) continue
      if (w.occupant !== null && w.occupant !== player) continue
      ws = e
      break
    }

    const missing: string[] = []
    for (const [sid, lv] of Object.entries(spec.requirements)) {
      const have = levelOf(skills[sid as SkillId] ?? 0)
      const need = lv ?? 0
      if (have < need) {
        missing.push(`${SKILLS[sid as SkillId].label} ${have} → 需 ${need}`)
      }
    }
    if (spec.repReq && spec.repReq.faction === 'anaheim' && aeRep < spec.repReq.min) {
      missing.push(`AE 声望 ${aeRep} → 需 ${spec.repReq.min}`)
    }
    if (spec.relationReq) {
      const need = spec.relationReq
      if (bestBoardOpinion < need.minOpinion) {
        const have = bestBoardOpinion === -Infinity ? 0 : bestBoardOpinion
        const target = bestBoardName ? `${bestBoardName} (印象 ${Math.round(have)})` : 'AE 董事会成员'
        missing.push(`与 ${target} 印象 → 需 ≥ ${need.minOpinion}`)
      }
    }

    rows.push({
      specId,
      spec,
      ws,
      isCurrent: specId === currentRankSpecId,
      missing,
    })
  }
  rows.sort((a, b) => (a.spec.rank ?? 0) - (b.spec.rank ?? 0))

  const accept = (row: RankRow) => {
    if (!row.ws) return
    if (row.missing.length > 0) return
    if (row.isCurrent) return
    const w = row.ws.get(Workstation)
    if (!w || (w.occupant !== null && w.occupant !== player)) return

    const prev = job?.workstation ?? null
    if (prev && prev !== row.ws) {
      const pw = prev.get(Workstation)
      if (pw && pw.occupant === player) prev.set(Workstation, { ...pw, occupant: null })
    }
    row.ws.set(Workstation, { ...w, occupant: player })
    player.set(Job, { workstation: row.ws, unemployedSinceMs: 0 })
    if (player.has(JobTenure)) player.set(JobTenure, { shiftsAtCurrentRank: 0 })
    clearPromotionNoticeForFamily('anaheim_engineering')
    useUI.getState().setDialogNPC(null)
  }

  return (
    <section className="status-section conversation-extension">
      <h3 style={{ color: aeMeta.accentColor }}>{aeMeta.nameZh} · 申请职级</h3>
      <p className="hr-intro">
        本工坊设有四个职级，按下表逐级晋升 ——
        技能、声望、与董事会成员的关系缺一不可。
      </p>
      <div className="status-meta">
        当前 AE 声望: <strong>{aeRep >= 0 ? '+' : ''}{Math.round(aeRep)}</strong>
        {tenure && currentRankSpecId ? ` · 当前职级累计班次: ${tenure.shiftsAtCurrentRank}` : ''}
      </div>

      {rows.length === 0 && <p className="hr-intro">暂无可申请的职级。</p>}
      {rows.map((row) => {
        const filled = row.ws === null && !row.isCurrent
        const locked = row.missing.length > 0
        const available = !locked && !row.isCurrent && row.ws !== null
        return (
          <div
            key={row.specId}
            className={`hr-job ${available ? '' : 'disabled'} ${row.isCurrent ? 'current' : ''}`}
          >
            <div className="hr-job-info">
              <div className="hr-job-name">
                {row.spec.rank ?? '?'} · {row.spec.jobTitle}
              </div>
              {row.spec.description && <div className="hr-job-desc">{row.spec.description}</div>}
              <div className="hr-job-wage">
                月薪 ¥{row.spec.wage} · {row.spec.shiftStart}:00 – {row.spec.shiftEnd}:00 · 经验 +{row.spec.skillXp}
              </div>
              {locked && (
                <div className="hr-job-reqs">
                  <span className="hr-req-label">未达条件: </span>
                  {row.missing.map((m, i) => (
                    <span key={i} className="req-missed">
                      {m}{i < row.missing.length - 1 ? ' · ' : ''}
                    </span>
                  ))}
                </div>
              )}
              {filled && !locked && (
                <div className="hr-job-reqs"><span className="req-missed">岗位已被占用</span></div>
              )}
            </div>
            <div className="hr-job-action">
              {row.isCurrent ? (
                <span className="hr-current-tag">当前</span>
              ) : (
                <button
                  className="hr-accept"
                  disabled={!available}
                  onClick={() => accept(row)}
                >
                  {available ? '申请' : (locked ? '不合格' : '已占用')}
                </button>
              )}
            </div>
          </div>
        )
      })}
    </section>
  )
}
