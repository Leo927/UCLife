// HUD condition strip. Worldspace overlay (sibling of MapWarnings) —
// one icon per active condition instance on the player. Click opens
// the StatusPanel's 健康 section. Severity tier drives the glyph fill;
// undiagnosed conditions render anonymized with a `?` overlay.
//
// Hover tooltip (zh-CN): condition name (or '某种疾病' if undiagnosed)
// + severity tier label.

import { useQueryFirst, useTrait } from 'koota/react'
import { IsPlayer, Conditions } from '../ecs/traits'
import { getConditionTemplate, severityTier, type SeverityTier } from '../character/conditions'
import { useUI } from './uiStore'

const TIER_ZH: Record<SeverityTier, string> = {
  mild: '轻微',
  moderate: '中等',
  severe: '严重',
}

const TIER_FILL: Record<SeverityTier, string> = {
  mild: '#facc15',
  moderate: '#f97316',
  severe: '#ef4444',
}

const FAMILY_GLYPH: Record<string, string> = {
  acute: '🤒',
  injury: '🩹',
  chronic: '⚕',
  mental: '☁',
  pregnancy: '✦',
}

export function ConditionStrip() {
  const player = useQueryFirst(IsPlayer, Conditions)
  const cond = useTrait(player, Conditions)
  const setStatus = useUI((s) => s.setStatus)
  if (!cond || cond.list.length === 0) return null

  // Hide incubating instances — symptoms haven't begun.
  const visible = cond.list.filter((c) => c.phase !== 'incubating')
  if (visible.length === 0) return null

  return (
    <div className="condition-strip" onClick={() => setStatus(true)}>
      {visible.slice(0, 6).map((inst) => {
        const template = getConditionTemplate(inst.templateId)
        if (!template) return null
        const tier = severityTier(inst.severity)
        const name = inst.diagnosed ? template.displayName : '某种疾病'
        const glyph = FAMILY_GLYPH[template.family] ?? '?'
        const tooltip = `${name} — ${TIER_ZH[tier]}（严重度 ${Math.round(inst.severity)}）`
        return (
          <div
            key={inst.instanceId}
            className={`condition-icon ${inst.phase}`}
            style={{ background: TIER_FILL[tier] }}
            title={tooltip}
            data-testid="condition-icon"
            data-template={template.id}
            data-phase={inst.phase}
            data-severity={Math.round(inst.severity)}
            data-diagnosed={inst.diagnosed ? '1' : '0'}
          >
            <span className="condition-icon-glyph">{glyph}</span>
            {!inst.diagnosed && <span className="condition-icon-q">?</span>}
            {inst.phase === 'stalled' && <span className="condition-icon-stalled">!</span>}
          </div>
        )
      })}
      {visible.length > 6 && (
        <div className="condition-icon condition-icon-overflow" title="更多">+{visible.length - 6}</div>
      )}
    </div>
  )
}
