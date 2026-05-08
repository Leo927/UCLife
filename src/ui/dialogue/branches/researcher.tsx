import { useState } from 'react'
import { useQuery, useTrait } from 'koota/react'
import type { Entity } from 'koota'
import {
  Character, FactionResearch, Job, Workstation,
} from '../../../ecs/traits'
import { world } from '../../../ecs/world'
import { playUi } from '../../../audio/player'
import {
  cancelHead, dequeueResearch, enqueueResearch, findFactionForResearcherStation,
  plannerView, reorderQueue,
} from '../../../systems/research'
import { dialogueText } from '../../../data/dialogueText'
import { getResearchSpec } from '../../../data/research'
import type { DialogueCtx, DialogueNode } from '../types'

export function researcherBranch(ctx: DialogueCtx): DialogueNode | null {
  if (!ctx.roles.isResearcherOnDuty) return null
  return {
    id: 'researcher',
    label: dialogueText.buttons.researcher,
    info: (ctx.npc.get(Character)?.name ?? '研究员') + dialogueText.branches.researcher.titleSuffix,
    specialUI: () => <ResearcherPanel researcher={ctx.npc} />,
  }
}

function ResearcherPanel({ researcher }: { researcher: Entity }) {
  const recInfo = useTrait(researcher, Character)
  const recJob = useTrait(researcher, Job)
  // Subscribe to FactionResearch so the panel re-renders after queue ops.
  void useQuery(FactionResearch)

  const station = recJob?.workstation ?? null
  if (!station) return null
  const wsTrait = station.get(Workstation)
  if (!wsTrait || wsTrait.occupant !== researcher) return null

  const faction = findFactionForResearcherStation(world, station)
  if (!faction) return null
  const view = plannerView(faction)
  if (!view) return null

  const [reply, setReply] = useState<string | null>(null)
  const [showPlanner, setShowPlanner] = useState(false)

  const onStatus = () => {
    playUi('ui.npc.smalltalk')
    if (view.queue.length === 0) {
      setReply(dialogueText.branches.researcher.idleReply)
      return
    }
    const head = view.queue[0]
    const eta = computeEta(head.cost - head.accumulated, view.yesterdayPerDay)
    const tail = eta == null ? '——节奏不稳，估不准。' : `照昨日的节奏，约 ${eta} 天。`
    setReply(`正在做：${head.nameZh}（已完成 ${Math.floor(head.accumulated)} / ${head.cost}）。${tail}`)
  }

  const onSuggestNext = () => {
    playUi('ui.npc.smalltalk')
    const top = view.available.slice(0, 5)
    if (top.length === 0) {
      setReply('暂时没有可立即上马的项目。')
      return
    }
    const lines = top.map((r) => `· ${r.nameZh}（${r.cost} 进度）`).join('\n')
    setReply(`可以接下来研究：\n${lines}\n打开计划面板把它们排进队列。`)
  }

  const onCancelHead = () => {
    playUi('ui.npc.farewell')
    if (view.queue.length === 0) {
      setReply('队列里本来就没东西。')
      return
    }
    const ok = window.confirm(dialogueText.branches.researcher.cancelHeadConfirm)
    if (!ok) return
    if (cancelHead(faction)) {
      setReply('好——我先停下手头的。')
    }
  }

  const onOpenPlanner = () => {
    playUi('ui.factory-manager.accept')
    setShowPlanner(true)
  }

  return (
    <>
      <h3>{recInfo?.name ?? '研究员'}{dialogueText.branches.researcher.titleSuffix}</h3>
      <div className="hr-intro">
        队列 {view.queue.length} · 已完成 {view.done.length} · 昨日产出 {Math.round(view.yesterdayPerDay)}
        {view.lostOverflowToday > 0 && ` · ${dialogueText.branches.researcher.lostLabel} ${Math.round(view.lostOverflowToday)}`}
      </div>
      {reply && <p className="dialog-response" style={{ whiteSpace: 'pre-line' }}>{reply}</p>}

      <div className="dialog-options">
        <button className="dialog-option" onClick={onStatus}>现在在搞什么？</button>
        <button className="dialog-option" onClick={onSuggestNext}>有什么新的可以研究的？</button>
        <button className="dialog-option" onClick={onCancelHead}>先停下手头的吧</button>
        <button className="dialog-option" onClick={onOpenPlanner}>给我看一下计划</button>
      </div>

      {showPlanner && (
        <ResearchPlanner faction={faction} onClose={() => setShowPlanner(false)} />
      )}
    </>
  )
}

function ResearchPlanner({ faction, onClose }: { faction: Entity; onClose: () => void }) {
  // Subscribe to faction trait so reorder/cancel re-render.
  void useTrait(faction, FactionResearch)
  const view = plannerView(faction)
  if (!view) return null
  const t = dialogueText.branches.researcher

  return (
    <div className="status-overlay" onClick={onClose}>
      <div className="status-panel" onClick={(e) => e.stopPropagation()}>
        <header className="status-header">
          <h2>{t.plannerTitle}</h2>
          <button className="status-close" onClick={onClose} aria-label="关闭">✕</button>
        </header>
        <section className="status-section">
          <div className="hr-intro">
            {t.todayLabel} {Math.round(view.yesterdayPerDay)}
            {view.lostOverflowToday > 0 && ` · ${t.lostLabel} ${Math.round(view.lostOverflowToday)}`}
          </div>

          <h3 style={{ marginTop: 8 }}>{t.queueHeader}</h3>
          {view.queue.length === 0 && <p className="hr-intro">{t.emptyQueueHint}</p>}
          <div className="secretary-hire-list">
            {view.queue.map((row, idx) => (
              <div key={row.id} className="apt-row">
                <div className="apt-row-info">
                  <div className="apt-row-name">
                    {idx === 0 && '▶ '}{row.nameZh}
                  </div>
                  <div className="apt-row-meta">
                    {row.descZh} · {row.cost} 进度
                    {row.accumulatedAtHead && row.accumulated > 0 && ` · 已积累 ${Math.floor(row.accumulated)}`}
                    {idx > 0 && (() => {
                      const eta = computeEta(row.cost, view.yesterdayPerDay)
                      return eta == null ? '' : ` · ETA ${eta} 天`
                    })()}
                  </div>
                </div>
                <div className="apt-row-actions">
                  {idx > 0 && (
                    <button
                      className="apt-row-buy"
                      onClick={() => reorderQueue(faction, idx, idx - 1)}
                    >上移</button>
                  )}
                  {idx < view.queue.length - 1 && (
                    <button
                      className="apt-row-buy"
                      onClick={() => reorderQueue(faction, idx, idx + 1)}
                    >下移</button>
                  )}
                  {idx === 0 ? (
                    <button
                      className="apt-row-buy"
                      onClick={() => {
                        const ok = window.confirm(t.cancelHeadConfirm)
                        if (ok) cancelHead(faction)
                      }}
                    >取消</button>
                  ) : (
                    <button
                      className="apt-row-buy"
                      onClick={() => dequeueResearch(faction, row.id)}
                    >移除</button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <h3 style={{ marginTop: 12 }}>{t.availableHeader}</h3>
          {view.available.length === 0 && <p className="hr-intro">{t.emptyAvailableHint}</p>}
          <div className="secretary-hire-list">
            {view.available.map((row) => (
              <div key={row.id} className="apt-row">
                <div className="apt-row-info">
                  <div className="apt-row-name">{row.nameZh}</div>
                  <div className="apt-row-meta">{row.descZh} · {row.cost} 进度</div>
                </div>
                <div className="apt-row-actions">
                  <button
                    className="apt-row-buy"
                    onClick={() => enqueueResearch(faction, row.id)}
                  >加入队列</button>
                </div>
              </div>
            ))}
          </div>

          <h3 style={{ marginTop: 12 }}>{t.lockedHeader}</h3>
          {view.locked.length === 0 && <p className="hr-intro">{t.emptyLockedHint}</p>}
          <div className="secretary-hire-list">
            {view.locked.map((row) => (
              <div key={row.id} className="apt-row faded">
                <div className="apt-row-info">
                  <div className="apt-row-name">{row.nameZh}</div>
                  <div className="apt-row-meta">
                    {row.descZh} · {row.cost} 进度 · 需要前置研究：
                    {row.missingPrereqIds.map((p) => getResearchSpec(p)?.nameZh ?? p).join('、')}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <h3 style={{ marginTop: 12 }}>{t.doneHeader}</h3>
          {view.done.length === 0 && <p className="hr-intro">{t.emptyDoneHint}</p>}
          <div className="secretary-hire-list">
            {view.done.map((row) => (
              <div key={row.id} className="apt-row">
                <div className="apt-row-info">
                  <div className="apt-row-name">✓ {row.nameZh}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}

function computeEta(remaining: number, perDay: number): number | null {
  if (perDay <= 0) return null
  return Math.max(1, Math.ceil(remaining / perDay))
}
