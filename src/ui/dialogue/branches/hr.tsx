import { useQuery, useQueryFirst, useTrait } from 'koota/react'
import type { Entity } from 'koota'
import { IsPlayer, Attributes, Job, Workstation, Position } from '../../../ecs/traits'
import { useUI } from '../../uiStore'
import { SKILLS, levelOf, getSkillXp, type SkillId } from '../../../character/skills'
import { dowLabel, getJobSpec } from '../../../data/jobs'
import type { JobSpec } from '../../../config'
import { playUi } from '../../../audio/player'
import { dialogueText } from '../../../data/dialogueText'
import type { DialogueCtx, DialogueNode } from '../types'

export function hrBranch(ctx: DialogueCtx): DialogueNode | null {
  if (!ctx.roles.isHROnDuty) return null
  return {
    id: 'hr',
    label: dialogueText.buttons.hr,
    info: dialogueText.branches.hr.title,
    specialUI: () => <HRPanel managerStation={null} />,
  }
}

export function factoryManagerBranch(ctx: DialogueCtx): DialogueNode | null {
  if (!ctx.roles.isRecruitingManagerOnDuty) return null
  const ws = ctx.roles.managerStation
  if (!ws) return null
  return {
    id: 'factoryManager',
    label: dialogueText.buttons.factoryManager,
    info: dialogueText.branches.factoryManager.title,
    specialUI: () => <HRPanel managerStation={ws} />,
  }
}

// Single panel shared by city HR and factory-manager hire flows. The
// only difference is which subset of stations is on offer:
//   • managerStation === null → public HR opening list (no employer, no
//     local manager)
//   • managerStation === <desk> → only stations whose managerStation
//     matches this desk
function HRPanel({ managerStation }: { managerStation: Entity | null }) {
  const player = useQueryFirst(IsPlayer, Attributes, Job)
  void useTrait(player, Attributes)
  const job = useTrait(player, Job)
  const allStations = useQuery(Workstation, Position)

  const openings: { ws: Entity; spec: JobSpec }[] = []
  for (const ws of allStations) {
    const w = ws.get(Workstation)
    if (!w) continue
    if (w.occupant !== null && w.occupant !== player) continue
    if (managerStation === null) {
      if (w.managerStation !== null) continue
    } else {
      if (w.managerStation !== managerStation) continue
    }
    const spec = getJobSpec(w.specId)
    if (!spec || !spec.playerHireable) continue
    if (managerStation === null && spec.employer) continue
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
    playUi(managerStation ? 'ui.factory-manager.accept' : 'ui.hr.accept')
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
  const emptyText = managerStation
    ? dialogueText.branches.factoryManager.empty
    : dialogueText.branches.hr.empty

  return (
    <>
      <h3>{managerStation ? dialogueText.branches.factoryManager.title : dialogueText.branches.hr.title}</h3>
      {openings.length === 0 && <p className="hr-intro">{emptyText}</p>}
      {openings.map(({ ws, spec }) => {
        const qualified = meets(spec)
        const current = isCurrent(ws)
        const reqEntries = Object.entries(spec.requirements) as [SkillId, number][]
        const daysLabel =
          spec.workDays.length === 7 ? '每天' : spec.workDays.map(dowLabel).join('/')
        return (
          <div
            key={ws.id()}
            className={`hr-job ${qualified ? '' : 'disabled'} ${current ? 'current' : ''}`}
          >
            <div className="hr-job-info">
              <div className="hr-job-name">{spec.jobTitle}</div>
              {spec.description && <div className="hr-job-desc">{spec.description}</div>}
              <div className="hr-job-wage">
                月薪 ¥{spec.wage} · {daysLabel} {spec.shiftStart}:00 – {spec.shiftEnd}:00 · 经验 +{spec.skillXp}
              </div>
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
    </>
  )
}
