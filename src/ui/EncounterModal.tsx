// Text-event-first encounter modal. Renders the active encounter's setup
// prose plus one button per qualifier-satisfied choice. No close X — the
// choices are the exits (encounters are committal per Design/encounters.md).

import { useEncounter, evaluateQualifier } from '../sim/encounters'
import type { Choice } from '../data/encounters'

function qualifierBadge(c: Choice): string | null {
  if (!c.qualifier) return null
  const r = evaluateQualifier(c.qualifier)
  return r.label ? `[${r.label}]` : null
}

export function EncounterModal() {
  const current = useEncounter((s) => s.current)
  if (!current) return null

  const { template, visibleChoices } = current

  return (
    <div className="status-overlay">
      <div className="status-panel" onClick={(e) => e.stopPropagation()}>
        <header className="status-header">
          <h2>遭遇</h2>
        </header>
        <section className="status-section">
          <p className="map-place-desc" style={{ whiteSpace: 'pre-line' }}>
            {template.textZh}
          </p>
        </section>
        <section className="status-section">
          {visibleChoices.map((c) => {
            const badge = qualifierBadge(c)
            return (
              <div key={c.id} className="transit-terminal-row">
                <div className="transit-terminal-info">
                  <div className="transit-terminal-name">{c.textZh}</div>
                  {badge && (
                    <p className="transit-terminal-desc">{badge}</p>
                  )}
                </div>
                <button
                  className="transit-terminal-go"
                  onClick={() => useEncounter.getState().resolveChoice(c.id)}
                >
                  选择
                </button>
              </div>
            )
          })}
        </section>
      </div>
    </div>
  )
}
