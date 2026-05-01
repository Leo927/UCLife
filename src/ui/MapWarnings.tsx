import { useQueryFirst, useTrait } from 'koota/react'
import { IsPlayer, Vitals, Health } from '../ecs/traits'

const VITAL_WARN = 50
const HP_WARN = 50

export function MapWarnings() {
  const player = useQueryFirst(IsPlayer, Vitals, Health)
  const vitals = useTrait(player, Vitals)
  const health = useTrait(player, Health)
  if (!vitals || !health) return null

  const items: { key: string; label: string; value: number; invert: boolean }[] = []
  if (vitals.thirst >= VITAL_WARN) items.push({ key: 'thirst', label: '口渴', value: vitals.thirst, invert: false })
  if (vitals.hunger >= VITAL_WARN) items.push({ key: 'hunger', label: '饥饿', value: vitals.hunger, invert: false })
  if (vitals.fatigue >= VITAL_WARN) items.push({ key: 'fatigue', label: '疲劳', value: vitals.fatigue, invert: false })
  if (vitals.hygiene >= VITAL_WARN) items.push({ key: 'hygiene', label: '清洁', value: vitals.hygiene, invert: false })
  if (health.hp <= HP_WARN) items.push({ key: 'hp', label: '健康', value: health.hp, invert: true })

  if (items.length === 0) return null

  return (
    <div className="map-warnings">
      {items.map((it) => (
        <WarnBar key={it.key} label={it.label} value={it.value} invert={it.invert} />
      ))}
    </div>
  )
}

function WarnBar({ label, value, invert }: { label: string; value: number; invert: boolean }) {
  const filled = Math.max(0, Math.min(100, value))
  const goodness = invert ? filled : 100 - filled
  const color = goodness > 30 ? '#facc15' : goodness > 10 ? '#f97316' : '#ef4444'
  const desc = describe(value, invert)
  return (
    <div className="warn-bar">
      <span className="warn-label">{label}</span>
      <div className="warn-track">
        <div className="warn-fill" style={{ width: `${filled}%`, background: color }} />
      </div>
      <span className="warn-desc" style={{ color }}>{desc}</span>
    </div>
  )
}

function describe(value: number, invertedHp: boolean): string {
  if (invertedHp) {
    if (value >= 50) return '轻伤'
    if (value >= 25) return '重伤'
    return '濒死'
  }
  if (value < 75) return '明显'
  if (value < 90) return '严重'
  return '极限'
}
