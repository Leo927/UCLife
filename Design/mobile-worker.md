# Mobile worker subsystem

*The first concrete gameplay verb behind the piloting skill. Feeds the
`mw_pilot` ambition; later reskinned for spacecraft and (Phase 7+) mobile
suits. Phase 5.4.*

## Why this exists

The `mw_pilot` ambition asks the player to push piloting from 0 → 10000 XP
across five stages. Without a verb that exercises piloting, those stages
collapse to "wait at a job" and the ambition becomes a timer. This file
specifies the verb.

The design rule: this minigame must remain interesting at session 100. If
the player's first instinct at session 30 is to skip, the minigame has
failed and we have not delivered on the ambition.

## Player verb in one sentence

You sit in an MW cockpit and **steer a heavy load through tolerance windows
under inertia**, against a clock and against your own jitter. Piloting and
Reflex change how the cockpit feels.

## Where the player enters it

Four entry points, gated by ambition progress. Each is a **diegetic place
in the city** the player walks to — never a raw menu button.

| Entry | Building | Unlock | Session shape | Cost / payout |
|---|---|---|---|---|
| **Sim Pod** | MW Academy (fixed building, commercial district near AE complex) | Day 1 | 1 task, ~60s | Player pays ¥150–¥800 per session |
| **MW Operator job** | Spaceport Dock (fixed building) | After `mw_pilot` stage 2 (qualification) — listed at HR Office | 3–5 tasks per shift, full work-shift commit | Wage scales with mean session score |
| **AE Test Range** | Inside AE Complex | After `mw_pilot` stage 3 (simulator training) | 1 task, T4 difficulty | Free; AE rep + piloting XP |
| **Federation MW Trial** | Federation consulate annex | After `mw_pilot` stage 4 (real-machine evaluation) | 1 task, T5 difficulty | Federation rep + piloting XP; failure costs Federation rep |

Sim Pod is the only entry available at piloting 0. Players grind there to
clear stage-1's piloting threshold, then use the MW Operator job as the
main XP pipeline because it pays. The two later entries exist to translate
ambition stages into *new content tiers* unlocking, not just bigger
numbers.

The Sim Pod and Test Range render as a **walk-up workstation** with a
"进入模拟舱" (enter sim pod) interaction. The Operator job triggers the
minigame on shift start, in place of the standard work-tick wage formula.

## The session loop

One session = one to several **tasks**, each ≤ 90 game-seconds. Game time
pauses while the minigame modal is open — a minigame session is real-time
input, not sim-time.

```
session start
 → task 1 [60–90s]   → score 0–100
 → task 2 [60–90s]   → score 0–100
 → ...
 → session score = mean
 → XP awarded, money/rep delta applied, log line emitted
```

A **task** is composed from one of four **primitives**. Variant difficulty
per task: tolerance window, time pressure, load mass, waypoint count. The
session UI displays a bar telling the player the task tier (T1–T5) before
they accept it; if they have an auto-resolve unlock (see below) it offers
a button to skip.

## Task primitives

All primitives share one input model — **steer a reticle that lags behind
your input under inertia** — so muscle memory transfers across primitives
and across reskins (spacecraft, mobile suit).

| Primitive | What you do | Skill levers |
|---|---|---|
| **Lift** | Pick up a crate, navigate a 3–5 waypoint path through tolerance gates, place inside footprint. | Tolerance width, waypoint spacing, time pressure |
| **Stack** | Place loads onto a tower, each tier with stricter angular tolerance. Misalignment > N° collapses everything. | Angular tolerance per tier, stack height |
| **Weld** | Hold the reticle on a moving track for N seconds. Track speed and curvature scale with tier. | Track speed, jitter amplitude |
| **Salvage** | Time-pressured grab list among drifting debris. Wrong grabs cost score. | Decoy density, drift speed, list length |

Four primitives is the **minimum viable variety** to defeat boredom while
keeping authoring cost low. Adding more is cheap (data-driven scenario
table); cutting below four risks the player feeling like they're playing
the same task forever.

## Skill impact (the part that has to be perceptible)

Both stats must move the cockpit *feel*, not just multiply a final score.
If the player can't tell from the controls that they're better than they
were ten hours ago, the skill is invisible.

### Piloting (skill, 0–10000)

- **Tolerance window scaling**: a T1 tolerance window of 1.0 tile shrinks
  to 0.4 tile at T5. Piloting *expands* the effective window by up to 1.6×
  at maxed skill. At piloting 0 a T1 task feels twitchy; at piloting 5000 a
  T1 task feels easy and a T3 task feels twitchy. **The challenge tier the
  player can comfortably attempt is the read-out of their skill.**
- **Inertia damping**: the load's overshoot/oscillation decays faster.
  Visible: at low piloting a stop request lets the load coast 1.5 tiles
  past the target; at high piloting it coasts 0.4 tiles.
- **Score multiplier ceiling**: per-tier score caps. A T1 task caps at 100
  for any piloting level, but a T5 task caps at 60 for piloting 3000 — the
  player physically cannot ace content far above their level.

### Reflex (attribute, 0–100)

- **Input lag**: high-Reflex pilots see a tighter input → reticle response
  curve. Low-Reflex pilots feel a perceptible delay between thumbing the
  stick and the load reacting.
- **Cursor jitter**: a small random offset added to the reticle each tick;
  amplitude is inverse to Reflex. At Reflex 100 the reticle is steady; at
  Reflex 30 it visibly wobbles.

### Intelligence (attribute, 0–100)

- Standard skill-XP multiplier (already shipped). No new input effect.

### Endurance (attribute, 0–100)

- During an Operator-job shift (multiple tasks), low-Endurance pilots
  accumulate fatigue between tasks: a screen shake / blur overlay grows
  task-over-task and shrinks the effective tolerance window. At
  Endurance 100 the overlay never appears within a single shift; at
  Endurance 20 it's perceptible by task 3.

## Reward economy

Per-session payouts are tuned so each ambition stage is **20–40 sessions
of the highest tier you can comfortably attempt**, not 200.

| Tier | Unlocked at piloting | Base XP @ score 100 | Notes |
|---|---|---|---|
| T1 | 0 | 30 | Sim Pod default |
| T2 | 1000 | 80 | Operator job baseline |
| T3 | 3000 | 150 | Operator job high-pay shift |
| T4 | 6000 | 250 | AE Test Range |
| T5 | 9000 | 400 | Federation Trial |

XP awarded = `baseXp × (score/100) × intelligenceMultiplier`. The score
floor is 30 (a botched session still teaches you a little).

Money: Sim Pod is a **cost** (¥150 T1 → ¥800 T4). Operator job pays a
shift wage scaled by mean session score against the standard
`wageMultiplier` curve. Test Range and Federation Trial pay reputation,
not money.

## Anti-grind: why session 100 still matters

Three levers, all required:

1. **Diminishing XP from below-tier content.** XP gain from tasks ≥ 2000
   piloting below the player's current piloting is multiplied by 0.25.
   The player who tries to grind T1 to 8000 gets a quarter the XP of one
   who climbs the tier ladder. Forces upward pressure without forbidding
   grinding outright.
2. **Auto-resolve unlock.** When piloting ≥ tier-threshold + 2000, the
   session UI offers an "auto-resolve at 80% expected score" button. The
   player can clear stale low-tier sessions in one click. This is
   hyperspeed for the minigame: it compresses *engagement that's already
   exhausted*, not engagement still on the table. Auto-resolve never
   appears on T4/T5 — those are the always-handcrafted moments.
3. **Scenario rotation.** Each session draws a primitive + parameter set
   from a weighted bag with no-repeat memory of last 3. The player never
   plays the same exact task back-to-back even at the same tier.

## Failure handling

A task scoring < 30 logs a flavor line ("载荷砸在围栏上。地勤跑过来骂了一句。")
and counts as completed at minimum XP. There is no fail-state that boots
the player out of the session — that would weaponize the minigame against
players still learning the controls.

The Federation Trial is the one exception: a < 50 score on a T5 trial
costs Federation rep. Stage 4 of `mw_pilot` puts real stakes on the
controls. That's the point.

## Ambition stage interaction

The minigame produces piloting XP via the standard skills pipeline; the
ambition validator already reads `piloting` thresholds. **No new ambition
hooks required.** The MW Operator job is gated to appear in the HR Office
listings only after `mw_pilot` stage 2 fires its `mw_school_dialogue`
unlock — this turns the ambition's `unlocks` field into the gate for new
job listings, which is exactly the integration phase 5.0 designed for.

## Phasing

| Phase | Scope |
|---|---|
| **5.4a** | Sim Pod fixed building + minigame engine (input model + Lift primitive only) + T1 tier + XP wiring. Demo: a player walks to the academy, plays a T1 lift, gains piloting XP. |
| **5.4b** | Stack, Weld, Salvage primitives. T2/T3 tiers. MW Operator job listing gated on `mw_school_dialogue`. Hyperspeed-equivalent auto-resolve. |
| **5.4c** | AE Test Range + Federation Trial entry points. T4/T5 tiers. Endurance fatigue overlay. |
| **5.4d** | Tuning pass: rebalance XP yields, tolerance curves, money cost/payout against playtest data. |
| **6+** | Spacecraft reskin (same input model, new primitives: docking, Lagrange-point coast). |
| **7+** | Mobile suit reskin under wartime context. |

## What this minigame is NOT

- **Not a combat sim.** UC 0077 mobile workers do industrial work. War
  repurposing waits for Phase 7 unlocks. The peacetime fantasy is being
  inside a giant crane-mech, not a giant gun.
- **Not a separate mode.** It's a verb the player triggers from a
  walk-up interactable, same as eating or reading. The sim clock pauses
  during a session; the player returns to Von Braun afterward with money
  / XP / rep deltas applied through the standard channels.
- **Not the only way to grind piloting.** Spacecraft and (Phase 7+)
  mobile suit subsystems will share the piloting skill pool. A player
  who hates this minigame must have an alternative path eventually —
  but for Phase 5.4 this is the only path, and it has to carry.

## Related

- [social/ambitions.md](social/ambitions.md) — `mw_pilot` ambition stages this verb fulfills
- [characters/skills.md](characters/skills.md) — piloting skill XP pool
- [characters/attributes.md](characters/attributes.md) — Reflex / Endurance / Intelligence inputs
- [time.md](time.md) — minigame pauses sim clock; auto-resolve is the hyperspeed analog
- [phasing.md](phasing.md) — slots after Phase 5.3
