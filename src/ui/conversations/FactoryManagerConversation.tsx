import { useQuery, useQueryFirst, useTrait } from 'koota/react'
import type { Entity } from 'koota'
import { IsPlayer, Attributes, Job, Workstation, Position } from '../../ecs/traits'
import { useUI } from '../uiStore'
import { SKILLS, levelOf, getSkillXp, type SkillId } from '../../character/skills'
import { dowLabel, getJobSpec } from '../../data/jobs'
import type { JobSpec } from '../../config'

export function FactoryManagerConversation({ managerStation }: { managerStation: Entity }) {
  const player = useQueryFirst(IsPlayer, Attributes, Job)
  // Subscribe to Attributes so the skill-requirement chips refresh as XP grows.
  void useTrait(player, Attributes)
  const job = useTrait(player, Job)
  const allStations = useQuery(Workstation, Position)

  // Only stations whose manager-of-record is this manager's desk. No employer
  // gate here — the desk owns the local hierarchy regardless of corporate
  // affiliation, and the spawn linker only sets managerStation when there's
  // a kind:'manager' supervisor in the same building.
  const openings: { ws: Entity; spec: JobSpec }[] = []
  for (const ws of allStations) {
    const w = ws.get(Workstation)!
    if (!w) continue
    if (w.managerStation !== managerStation) continue
    if (w.occupant !== null && w.occupant !== player) continue
    const spec = getJobSpec(w.specId)
    if (!spec || !spec.playerHireable) continue
    openings.push({ ws, spec })
  }

  const meets = (spec: JobSpec): boolean => {
    if (!player) return false
    for (const [sid, lv] of Object.entries(spec.requirements)) {
      if (levelOf(getSkillXp(player, sid as SkillId)) < (lv ?? 0)) return false
    }
    return true
  }

  const accept = (ws: Entity, spec: JobSpec) => {
    if (!player || !meets(spec)) return
    const w = ws.get(Workstation)!
    if (w.occupant !== null && w.occupant !== player) return
    const prev = job?.workstation ?? null
    if (prev && prev !== ws) {
      const pw = prev.get(Workstation)
      if (pw && pw.occupant === player) prev.set(Workstation, { ...pw, occupant: null })
    }
    ws.set(Workstation, { ...w, occupant: player })
    player.set(Job, { workstation: ws, unemployedSinceMs: 0 })
    useUI.getState().setDialogNPC(null)
  }

  const isCurrent = (ws: Entity) => job?.workstation === ws

  return (
    <section className="status-section conversation-extension">
      <h3>本厂招聘</h3>
      {openings.length === 0 && <p className="hr-intro">本厂目前没有空缺岗位。</p>}
      {openings.map(({ ws, spec }) => {
        const qualified = meets(spec)
        const current = isCurrent(ws)
        const reqEntries = Object.entries(spec.requirements) as [SkillId, number][]
        const daysLabel = spec.workDays.length === 7 ? '每天' : spec.workDays.map(dowLabel).join('/')
        return (
          <div key={ws.id()} className={`hr-job ${qualified ? '' : 'disabled'} ${current ? 'current' : ''}`}>
            <div className="hr-job-info">
              <div className="hr-job-name">{spec.jobTitle}</div>
              {spec.description && <div className="hr-job-desc">{spec.description}</div>}
              <div className="hr-job-wage">月薪 ¥{spec.wage} · {daysLabel} {spec.shiftStart}:00 – {spec.shiftEnd}:00 · 经验 +{spec.skillXp}</div>
              {reqEntries.length > 0 && (
                <div className="hr-job-reqs">
                  <span className="hr-req-label">要求: </span>
                  {reqEntries.map(([sid, lv], i) => {
                    const playerLv = player ? levelOf(getSkillXp(player, sid)) : 0
                    const met = playerLv >= lv
                    return (
                      <span key={sid} className={met ? 'req-met' : 'req-missed'}>
                        {SKILLS[sid].label} Lv {lv}{i < reqEntries.length - 1 ? ', ' : ''}
                      </span>
                    )
                  })}
                </div>
              )}
            </div>
            <div className="hr-job-action">
              {current ? (
                <span className="hr-current-tag">当前</span>
              ) : (
                <button
                  className="hr-accept"
                  disabled={!qualified}
                  onClick={() => accept(ws, spec)}
                >
                  {qualified ? '接受' : '不合格'}
                </button>
              )}
            </div>
          </div>
        )
      })}
    </section>
  )
}
