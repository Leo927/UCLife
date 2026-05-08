# Facility tiers — owner-side investment (Phase 5.5.6+)

The investment loop on player-owned facilities. Each facility carries
four universal tier knobs the player can pour credits into, gated by
research. Tiers turn "I bought the bar" into a multi-month
progression: the bar gets bigger, more efficient, longer-running, more
loyal. Without it, ownership is a one-shot purchase plus a flat daily
yield.

## What this layer is for

Phase 5.5 economics — revenue, salary, maintenance — already produce
a flat per-facility daily net. Without a sink for accumulated profit,
"I bought the bar" plateaus. The realtor sells *new* facilities, but
each one is the same flat acquisition shape. The progression vector
that's been missing is **investment back into already-owned
facilities** — small upgrades to existing assets that compound.

This file pins the universal tier shape, the four knobs, the upgrade
flow, the research gating, and the manage-interactable surface they
live behind.

## The four universal tier knobs

Every owned facility carries the same four knobs. Each knob has a
`tier` integer (default 1); each knob's tier-N effects are configured
per facility class so a "tier-2 bar" and a "tier-2 factory" can scale
differently while sharing one shape.

| Knob | What it changes | Output channel |
|---|---|---|
| **Job-site count** | Adds extra seats to the facility | More aggregate output (revenue / research / recruitment) |
| **Job-site efficiency** | Multiplies each seat's per-shift output | revenue × eff, research progress × eff, recruit chance × eff |
| **Operating hours** | Extends the shift window | More daily output per seat; salaries scale with shift length |
| **On-job loyalty drift** | Workers gain loyalty / opinion of the owner faster while on shift | Recruit retention, bed-pressure resilience, talk-verb opinion floor |

The four apply universally because their effects are universally
meaningful — every facility has output, every facility has worker
shifts, every facility has loyalty. Magnitudes differ per class
(loyalty drift on a research lab matters less than on a bar); the
*channels* are the same.

The data shape per facility class:

```js
{
  facilityClass: 'factory',
  tiers: {
    jobSiteCount: [
      { tier: 1, sites: 4 },
      { tier: 2, sites: 6, requiresUnlock: 'upgrade:factory-tier-2', creditCost: 12000, downtimeDays: 3 },
    ],
    efficiency: [
      { tier: 1, mul: 1.00 },
      { tier: 2, mul: 1.15, requiresUnlock: 'upgrade:factory-eff-2', creditCost: 8000, downtimeDays: 2 },
    ],
    operatingHours: [
      { tier: 1, hours: [8, 18] },
      { tier: 2, hours: [7, 19], requiresUnlock: 'upgrade:longer-shifts', creditCost: 4000, downtimeDays: 1 },
    ],
    loyaltyDrift: [
      { tier: 1, mul: 1.00 },
      { tier: 2, mul: 1.20, requiresUnlock: 'upgrade:culture', creditCost: 6000, downtimeDays: 0 },
    ],
  }
}
```

Each tier-N row requires both the research-issued unlock string and
the credit spend. Locked tiers stay **visible** on the
manage-interactable panel with explicit gate text — a silent gate is
a bug.

## Cost: credits + downtime

Two costs per upgrade:

- **Credit cost** — paid at install time from the owning faction's
  fund. If the fund is short, the upgrade can't start.
- **Downtime** — the facility is offline for `downtimeDays`. During
  downtime the affected seat(s) produce no output and pay no salary;
  maintenance still applies.

Downtime is what gives the choice weight. A bar shutting down for 3
days is a real loss that the player schedules around demand — same as
a real bar owner. Tier rows that genuinely shouldn't take the seat
offline (e.g., loyalty-drift culture program) ship with `downtimeDays:
0`.

While a knob is upgrading, its panel row shows
`升级中 — 还剩 N 天`; on completion, the new tier value is live on
the next day's economics tick and a one-line entry surfaces in the
secretary's `bookSummary` and the daily log.

## Gate states the panel exposes

Each tier row renders as one of:

- **Locked** — `requiresUnlock` not in `FactionUnlocks`. Greyed, gate
  text inline (`需要研究: 工厂扩容 II`).
- **Available** — unlock present and credits sufficient. Confirm to
  start; downtime + cost shown.
- **In progress** — currently being installed. Days remaining shown.
- **Done** — already at this tier or higher. The row above this one
  is the player's next available step.

No state is hidden. The locked row is the diegetic seed that teaches
the player research exists; the in-progress row is the diegetic seed
that teaches the player downtime is real.

## Surface: the manage-interactable

A new owner-side branch on the worker-on-duty's talk-verb at any
player-owned facility, extending the existing branches in
[facilities-and-ownership.md](facilities-and-ownership.md#job-site-interaction-player-owned-facilities):

- **"想聊聊升级。" — "Let's talk about upgrades."** → opens the tier
  panel.

The tier panel is a dense view (four knobs × N tiers × authored copy
is not collapsible to a one-line dialogue). It is anchored on the
worker's body, not the workstation tile — same diegetic frame as the
realtor's listing or the recruiter's lobby panel.

### Empty-seat fallback: the secretary

If the seat is *vacant* (no worker on duty), the worker-anchored verb
doesn't exist — and an upgrade requiring the seat itself to be down
during downtime can otherwise dead-end. The clean fallback: the
manage-interactable also surfaces on the **secretary** at the
faction office, scoped to the faction's facilities. The secretary's
verb opens the same panel; the same writes apply. Diegetically, the
player tells their secretary to schedule the upgrade; mechanically,
the panel is identical.

This is symmetric with how the secretary already surfaces empty-seat
operations (`assignIdleMembers`,
[facilities-and-ownership.md](facilities-and-ownership.md#the-secretary-is-a-delegate-not-a-god-panel)).

## Tier defaults at game start

Every facility ships at tier 1 across all four knobs. Tier-1
efficiency = 1.0, tier-1 hours = the existing operating-hours config,
tier-1 loyalty drift = the existing baseline, tier-1 job-site count =
the existing per-class default. **Nothing changes for unowned or
NPC-owned facilities** — the tier system is player-faction content.
NPC factions stay at tier 1; NPC-AI extending tiers is a deferred
slot for the same Phase that lands NPC faction AI.

## How tier values fold into existing systems

Each knob plugs into an existing per-day or per-shift formula; no new
calculator engines.

- **Job-site count** — `Facility.jobSites` array length is the
  authored tier-N value. Worker auto-assignment fills the new seats
  the same way it fills any seat.
- **Job-site efficiency** — multiplies every output line that already
  reads workPerformance. `dailyEconomics` reads `efficiency.mul` into
  the revenue formula; `researchSystem` reads it into the progress
  formula; `recruitmentSystem` reads it into the chance formula. One
  field, three consumers.
- **Operating hours** — replaces the per-class operating-hours
  config when computing today's shift bounds. Salaries already scale
  with shift length per class config; nothing new.
- **On-job loyalty drift** — a per-shift hook on the worker's
  loyalty-drift tick that multiplies the drift target by the tier's
  `mul`. Reuses the loyalty-drift channel that
  [facilities-and-ownership.md](facilities-and-ownership.md) already
  invokes for housing pressure.

## Phasing

| Phase | Scope |
|---|---|
| **5.5.6** | Tier infrastructure: `FacilityTiers` trait, per-class authoring in `facility-types.json5`, manage-interactable surface (worker-anchored + secretary fallback), credit + downtime flow. First research-gated unlock string for `factory-tier-2`. Default tier-1 across all owned facilities — no behavior change without an upgrade. Save round-trip via per-Building EntityKey. |
| **5.5.7** | Authoring pass: tier-2 + tier-3 rows for each facility class; matching `research.json5` entries that gate them. ~3 tiers per knob per class is the initial budget. |
| **6.0+** | Tier rows that gate Phase 6 content (e.g., factory tier-4 unlocks "small MS-parts production at this facility"). |

## Related

- [research.md](research.md) — research is what authors and emits the unlock strings tier rows gate on
- [facilities-and-ownership.md](facilities-and-ownership.md) — daily economics; tier mults plug into the existing revenue / salary / maintenance / housing-pressure formulas
- [diegetic-management.md](diegetic-management.md) — manage-interactable lives on the worker; secretary fallback when the seat is in downtime
- [../phasing.md](../phasing.md) — sub-phasing
