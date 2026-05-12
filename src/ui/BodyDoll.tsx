// Phase 4.1 — body-part paper-doll. Silhouette tinted per region by
// the worst severity of any active condition (acute or chronic) on
// that body part. Eight regions, mirroring data/body-parts.json5:
// head, torso, two arms, two hands, two ankles.
//
// Rendered inside the StatusPanel Health section. Inspector-only —
// purely informational; click-through to filter the condition list
// is deferred per physiology-ux.md § Body-part paper-doll.

import type { ConditionInstance } from '../ecs/traits'
import { getConditionTemplate, SEVERITY_TIER_COLOR, severityTier, type SeverityTier } from '../character/conditions'

type Region = 'head' | 'torso' | 'left-arm' | 'right-arm' | 'left-hand' | 'right-hand' | 'left-ankle' | 'right-ankle'

const TIER_RANK: Record<SeverityTier | 'none', number> = {
  none: 0, mild: 1, moderate: 2, severe: 3,
}

const NEUTRAL = '#3f3f46'

function worstTierByRegion(list: readonly ConditionInstance[]): Record<Region, SeverityTier | 'none'> {
  const out: Record<Region, SeverityTier | 'none'> = {
    'head': 'none', 'torso': 'none',
    'left-arm': 'none', 'right-arm': 'none',
    'left-hand': 'none', 'right-hand': 'none',
    'left-ankle': 'none', 'right-ankle': 'none',
  }
  for (const inst of list) {
    if (inst.phase === 'incubating') continue
    if (!inst.bodyPart) continue
    const region = inst.bodyPart as Region
    if (!(region in out)) continue
    const t = getConditionTemplate(inst.templateId)
    if (!t || t.bodyPartScope !== 'bodyPart') continue
    const tier = severityTier(inst.severity)
    if (TIER_RANK[tier] > TIER_RANK[out[region]]) out[region] = tier
  }
  return out
}

function fillFor(tier: SeverityTier | 'none'): string {
  return tier === 'none' ? NEUTRAL : SEVERITY_TIER_COLOR[tier]
}

export function BodyDoll({ conditions }: { conditions: readonly ConditionInstance[] }) {
  const worst = worstTierByRegion(conditions)
  const anyInjury = Object.values(worst).some((t) => t !== 'none')
  return (
    <svg
      className="body-doll"
      viewBox="0 0 120 200"
      width={120}
      height={200}
      data-testid="body-doll"
      data-any-injury={anyInjury ? '1' : '0'}
      role="img"
      aria-label="身体伤情示意图"
    >
      <ellipse cx="60" cy="22" rx="14" ry="16" fill={fillFor(worst['head'])} data-region="head" />
      <rect x="44" y="40" width="32" height="50" rx="8" fill={fillFor(worst['torso'])} data-region="torso" />
      <rect x="28" y="44" width="14" height="44" rx="6" fill={fillFor(worst['left-arm'])} data-region="left-arm" />
      <rect x="78" y="44" width="14" height="44" rx="6" fill={fillFor(worst['right-arm'])} data-region="right-arm" />
      <ellipse cx="35" cy="98" rx="8" ry="8" fill={fillFor(worst['left-hand'])} data-region="left-hand" />
      <ellipse cx="85" cy="98" rx="8" ry="8" fill={fillFor(worst['right-hand'])} data-region="right-hand" />
      <rect x="48" y="92" width="10" height="80" rx="5" fill={NEUTRAL} />
      <rect x="62" y="92" width="10" height="80" rx="5" fill={NEUTRAL} />
      <ellipse cx="53" cy="178" rx="9" ry="7" fill={fillFor(worst['left-ankle'])} data-region="left-ankle" />
      <ellipse cx="67" cy="178" rx="9" ry="7" fill={fillFor(worst['right-ankle'])} data-region="right-ankle" />
    </svg>
  )
}
