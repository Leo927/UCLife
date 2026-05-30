// Issue #70 — the per-prisoner verb wall, shared by the brig walk-up
// (BrigPanel) and the captain's-office comm-panel face wall
// (CommPanelDialog). Both surfaces render this one component so there is a
// single verb implementation; the buttons route through systems/prisoners.
//
// Player-facing strings zh-CN; the recruit gate hides its button when the
// prisoner's home-faction loyalty is above the configured ceiling.

import {
  interrogatePrisoner, ransomPrisoner, recruitPrisoner,
  executePrisoner, handOverPrisoner, releasePrisoner, canRecruitPrisoner,
} from '../systems/prisoners'
import type { PrisonerRecord } from '../sim/brig'
import { playUi } from '../audio/player'
import { useUI } from './uiStore'

const VERB_LABELS = {
  interrogate: '审讯',
  ransom: '索赎',
  recruit: '招募',
  execute: '处决',
  handOver: '移交',
  release: '释放',
} as const

export function PrisonerVerbRow({ prisoner }: { prisoner: PrisonerRecord }) {
  const showToast = useUI((s) => s.showToast)
  const recruitable = canRecruitPrisoner(prisoner.id)

  const run = (
    label: string,
    fn: (id: string) => { ok: boolean; reasonZh?: string; creditsDelta: number; intelTier?: string },
  ) => {
    const res = fn(prisoner.id)
    playUi(res.ok ? 'ui.hr.accept' : 'ui.npc.close')
    if (!res.ok) {
      showToast(res.reasonZh ?? '指令无法执行。')
      return
    }
    if (label === VERB_LABELS.interrogate) {
      const tierZh = res.intelTier === 'full' ? '完整情报'
        : res.intelTier === 'partial' ? '零散情报' : '一无所获'
      showToast(`审讯 · ${prisoner.nameZh} · ${tierZh}`)
    } else if (res.creditsDelta > 0) {
      showToast(`${label} · ${prisoner.nameZh} · +¥${res.creditsDelta}`)
    } else {
      showToast(`${label} · ${prisoner.nameZh}`)
    }
  }

  return (
    <div className="dialog-options" data-prisoner-verbs={prisoner.id}>
      <button
        className="dialog-option"
        data-prisoner-verb="interrogate"
        onClick={() => run(VERB_LABELS.interrogate, interrogatePrisoner)}
      >{VERB_LABELS.interrogate}</button>
      <button
        className="dialog-option"
        data-prisoner-verb="ransom"
        onClick={() => run(VERB_LABELS.ransom, ransomPrisoner)}
      >{VERB_LABELS.ransom}</button>
      {recruitable && (
        <button
          className="dialog-option"
          data-prisoner-verb="recruit"
          onClick={() => run(VERB_LABELS.recruit, recruitPrisoner)}
        >{VERB_LABELS.recruit}</button>
      )}
      <button
        className="dialog-option"
        data-prisoner-verb="execute"
        onClick={() => run(VERB_LABELS.execute, executePrisoner)}
      >{VERB_LABELS.execute}</button>
      <button
        className="dialog-option"
        data-prisoner-verb="handOver"
        onClick={() => run(VERB_LABELS.handOver, handOverPrisoner)}
      >{VERB_LABELS.handOver}</button>
      <button
        className="dialog-option"
        data-prisoner-verb="release"
        onClick={() => run(VERB_LABELS.release, releasePrisoner)}
      >{VERB_LABELS.release}</button>
    </div>
  )
}
