# Physiology — Player UX (Phase 4)

The system spec ([physiology.md](physiology.md)) defines onset paths,
lifecycle, recovery modes, and treatment tiers. None of it lands without
surfaces that let the player **perceive** condition state, **decide** between
treatment options, and **read the arc back** as story. This file is that
pass.

## Perception model

The system's central decision — *"is this bad enough to pay for a
diagnosis?"* — works only if the player can guess. So the information
gradient is:

| Layer | Player (own body) | Inspector (NPC + self) |
|---|---|---|
| **Severity tier** (轻微 / 中等 / 严重) | Always visible | Always visible |
| **Family** (illness / injury / mental / chronic) | Always visible | Always visible |
| **Body part** (4.1+) | Visible if injury | Visible |
| **Active modifiers** (drain mults, stat caps, lockouts) | Always visible | Always visible |
| **Canonical name** | Hidden until diagnosis | Always visible |
| **Predicted recovery days** | Hidden until diagnosis | Always visible |
| **Required treatment tier** | Hidden until diagnosis | Always visible |

Severity is never gated. The PZ-moodle / RimWorld-hediff hybrid is: moodle
*shape* on the HUD, RimWorld-style named list inside the inspector, and a
clinic-gated reveal of the canonical name on the player's own body.

The asymmetry is the loop. A player who can see severity but not name has
a *real* guess to make: ride out the cold, or pay 8c to learn it's not a
cold.

## Surfaces

### 1. HUD condition strip

A thin row beneath the existing vitals bars — one icon per active
condition, hover for a quick tooltip, click to open the card. Cap at six
visible icons; overflow collapses into a `+N` badge that opens the
character sheet's Health tab.

Each icon encodes:

- **Family glyph** — illness / injury / mental / chronic (four glyphs total).
- **Severity tier** — glyph fill at three levels (轻微 / 中等 / 严重).
- **Diagnosis state** — outline-only with a `?` overlay if undiagnosed;
  filled if diagnosed.
- **Pulse** — one-shot animation on band crossings, stalled→recovering,
  and complication spawns. The pulse is the player's peripheral signal that
  *something just changed* without forcing a modal.

Hover tooltip (zh-CN, one line):
- Diagnosed: `流感 — 中等(第 14 日 / 预计还有 3 日)`
- Undiagnosed: `某种疾病 — 中等(第 14 日发病)`

This is the always-on, glanceable layer. It must answer "am I currently
affected by something" without opening any modal.

### 2. Condition card

Click any strip icon (or the row in the Health tab) → a card panel.
Read-mostly; verbs are the only buttons.

**Symptomatic (undiagnosed) card:**

```
[icon] 某种疾病 — 中等
─────────────────────────────────────────
你浑身发冷,关节酸痛,提不起精神。
症状从第 12 日开始。

影响:
  • 疲劳上升加快
  • 工作效率下降
  • 力量上限降低

[ 自行用药 (1 药品) ]   [ 前往诊所 — 公共诊所 (8c) ]
```

**Diagnosed card:**

```
[icon] 流感 (Influenza) — 中等  · 严重度 42
─────────────────────────────────────────
按当前治疗强度,预计还有 4 日。
所需治疗:药店 ✓
治疗记录:第 12 日 在 公共诊所 确诊(8c) → 处方(20c)。

影响:
  • 疲劳上升加快 ×1.5
  • 工作效率 ×0.6

[ 自行用药 ]   [ 复诊 ]
```

The diagnosed card replaces hint-text with hard numbers because the player
has earned them.

### 3. Stalled state — explicit badge

When `treatment < requiredTier` for ≥ 1 game-day, the card and tooltip
gain a yellow `未见好转` badge plus an inline reason:

```
未见好转 — 自我护理无法治疗扭伤,需要药店或诊所介入。
```

Without this, the player rests at home for five days and feels cheated.
The badge is the **opposite of a silent gate**.

### 4. Symptom blurb on the event log

A symptomatic player gets one zh-CN flavor line on:

- Onset: *"你开始觉得头晕。"*
- Severity-band crossing: *"病情加重。"* / *"似乎有所好转。"*

Not on every game-day. A flat daily reminder ("you still feel sick") is
the kind of low-signal noise that trains players to ignore the log. The
HUD strip carries the persistent presence; the log carries the changes.

### 5. Daily digest line (game-day rollover)

Once per game-day, every active condition emits **one** log line with a
severity readback:

```
[第 14 日 早晨] 感冒 — 中等(28 → 21,正在好转)
[第 14 日 早晨] 扭伤 — 中等(42,未见好转)— 需要药店或诊所介入
```

The day-rollover hook already drives autosave; piggyback. This is the
player's daily mirror: "is treatment working?" is answered without
opening a modal. The "未见好转" tail is the stalled signal at the log
layer — second perception channel for the same state.

### 6. Toasts that wake hyperspeed

The hyperspeed contract from [physiology.md](physiology.md) (*"wakes on
diagnosis-relevant changes the same way it wakes on vital thresholds"*)
resolves to this table:

| Event | Toast (zh-CN) | Wakes hyperspeed |
|---|---|---|
| Onset → Symptomatic | *"你感觉身体不对劲。"* | **Yes** |
| Diagnosis | *"医生确诊:流感。"* | n/a (player initiated) |
| Severity-band crossing (worsening) | *"病情加重。"* | **Yes** |
| Severity-band crossing (improving) | *"你感觉好些了。"* | No |
| Stalled (after 1 day) | *"扭伤并未好转 — 也许需要专业治疗?"* | **Yes** |
| Complication (linked condition spawned) | *"你的伤口似乎感染了。"* | **Yes** |
| Recovery-clean | *"你已痊愈。"* | No |
| Recovery-scar | *"你已痊愈,但留下了一道旧伤。"* | **Yes** (souvenir is a future-decision moment) |
| Near-death (permadeath OFF) | *"你昏倒了。"* + fade | **Yes** |

Hyperspeed compresses *waiting* (three more days of fluid and rest), not
*engagement* (you guessed wrong and the ankle's now infected). The wake
list above is the line.

### 7. Clinic interactable

Walking up to a clinic interactable (existing pattern) opens a two-step
modal.

**Step 1 — diagnosis offer:**

```
公共诊所
─────────
当前症状:头晕、关节酸痛、疲劳

诊断费 — 8 信用点
[ 接受诊断 ]   [ 离开 ]
```

**Step 2 — treatment selection (after paying):**

```
诊断结果:流感

选择治疗方案:
  ○ 自我护理(免费)        预计 6 日 — 病情可能停滞
  ● 药店处方(20 信用点)    预计 4 日 — 推荐
  ○ 住院观察(60 信用点)    预计 3 日 — 留疤风险更低
[ 确认 ]   [ 离开 ]
```

Three calls:

- **Diagnosis fee is separate from treatment.** Player decides "is the
  name worth 8c?" before committing to a 60c hospital stay. Two decisions,
  not one.
- **Recommended option is preselected, not auto-confirmed.** The system
  isn't choosing for the player; it's surfacing the path of least
  surprise.
- **Predicted-days column is the legible knob.** The
  `recovery_multiplier` from the spec becomes a player-facing decision
  this way, not a hidden coefficient.

**First-clinic-visit free** (resolving the open question in
[physiology.md](physiology.md#open-questions)): yes, framed as a coupon
the game hands the player on first symptomatic onset (*"市政医保为新市民
提供一次免费就诊"*). Teaches the verb without making subsequent visits
feel taxed; folds civilian-welfare flavor into the world.

**AE clinic** is a separate building. Its door carries a faction badge
visible from outside. Below rep threshold the door reads *"安那海姆员工
通道 — 凭证不足"* — a self-explaining locked gate, clearable through the
existing AE rep loop. Inside, the modal is identical in shape; the
predicted-days column shifts (recommended option carries a `减少留疤风险`
note). This is the *"factions matter even if you're a civilian"* anchor
called out in the spec.

### 8. First Aid self-treat verb

A `自行处理` panel appears on the condition card when:

- Player has `First Aid ≥ 30`, **and**
- The condition row declares an unlock for an available verb
  (`bandage` / `splint` / `clean wound`), **and**
- Inventory has the required item (gauze, splint, antiseptic).

Single-button affair with success-preview tooltip:

```
包扎 (First Aid 38) → 治疗等效 药店,2 日内每日 −10 严重度
[ 执行 — 消耗 1 绷带 ]
```

Skill XP awards on use. First Aid pays off **in the moment**, not
"someday when you can afford it."

### 9. Inspector — Health tab

Click any character → existing inspector panel gains a 健康 tab:

- **Active conditions** — all named (inspector bypasses the diagnosis
  gate), with severity bars and modifier list.
- **Body-part diagram** (4.1+, see below) — silhouette tinted by worst
  injury per region.
- **Chronic stubs** — separate section; permanent.
- **Cause of death** — shown if `Health.dead`.

The player's own Health tab is the same shape, with one twist:
undiagnosed conditions show the symptom blurb in place of the canonical
name, with a `?`-tagged severity bar. This is the only place undiagnosed
and diagnosed conditions sit side-by-side, and it's the cheat sheet for
the player's own state.

### 10. Body-part paper-doll (Phase 4.1)

Silhouette: head / torso / 2× arms / 2× legs / hands / eyes. Each region
tints by worst-injury severity (无 / 轻微 / 中等 / 严重 → 灰 / 黄 / 橙 / 红).
Click a region → filtered condition list for that body part. Doubles as
the surface for *"this body part has scars"* without cluttering the
active-condition list.

Used in: inspector Health tab, optional pop-out from a condition card
when the condition has a `bodyPart`. **Not in the HUD strip** — six body
parts in the always-on HUD blows the perceptual budget.

### 11. Contagion awareness (Phase 4.2)

The *"I caught it from 李明 at the dock"* beat needs three hooks to land:

- **Visible carrier cue.** Symptomatic NPCs in the active zone emote a
  cough/sneeze icon over their head at random intervals (top-down sprite
  overlay; cheap). Players learn to associate the icon with risk and can
  *avoid* — agency, not dice.
- **Source attribution at onset.** When the contagion roll lands, the
  most-recent infectious carrier whose `contactRadius` covered the player
  is recorded into the condition's `source` field. Onset toast + log
  names them: *"你感冒了。最近接触过 李明(咳嗽)。"*
- **Workplace prevalence line.** When the player enters a workplace zone
  where prevalence > threshold, the log emits one line on entry:
  *"今天有三位同事请病假。"* This is the macro-signal the system spec
  references — it lands as a log beat, not a UI element.

Together these turn contagion from a dice roll into a **risk surface**
the player can read and react to.

### 12. Near-death and death

**Permadeath OFF.** A short fade-to-black flash → respawn at home or
nearest clinic, with a single log line:

```
你昏倒了。第 14 日 在 公共诊所 苏醒。新留下了 心肺旧伤(耐力上限 −5)。
```

**Permadeath ON.** Standard game-over modal with cause-of-death line and
final-stat readback.

The fade flash is the only screen-effect UX in this doc. Reserved for
near-death and severity → 100; everywhere else the HUD strip + toast +
log carry the load.

## Phase split

| Phase | UX surfaces shipped |
|---|---|
| **4.0** | HUD strip (illness icons), Symptomatic & Diagnosed condition card, symptom blurb on log, onset/diagnosis toasts + hyperspeed wake, daily digest line, civilian clinic modal (two-step), first-clinic-free coupon, inspector Health tab (active conditions only), near-death fade. |
| **4.1** | Body-part paper-doll, First Aid self-treat verb on the card, chronic-stubs section in Health tab, **stalled `未见好转` badge** on card + tooltip + digest, scar log line on resolution. |
| **4.2** | Contagion sprite emote, source attribution in onset toast/log, workplace prevalence log line on zone entry, AE clinic door badge + modal, *"减少留疤风险"* affordance copy. |

Each sub-phase ships independent player-visible play. The stalled badge
slipping into 4.1 (alongside injuries) is deliberate — colds in 4.0 don't
stall (they all run at `requiredTier = 0`), so the badge has no
content to surface until injuries arrive.

## Open questions

- **HUD strip placement.** Beneath vitals (vertical extension) or
  alongside (horizontal split)? Resolves at first prototype — bench
  until then.
- **Carrier prevalence as a number?** The Phase 4.2 line *"三位同事请
  病假"* is intentionally flavor. If playtest shows the signal isn't
  reaching, expose a small `prevalence: 高 / 中 / 低` chip on the
  workplace's interactable. Defer.
- **Diagnosis-aid item.** A cheap pamphlet or first-aid book that
  permanently widens the symptom→family hint (severity tier already
  free)? Optional onboarding lever; defer to onboarding pass.
- **Mid-symptom upgrade flow.** A player who self-treats a sprain at
  home, then walks to the clinic anyway — does the clinic modal show the
  partial recovery state? Yes (treatment history row), but verify the
  numbers read correctly when partial.

## Related

- [physiology.md](physiology.md) — system spec; this file is the
  player-facing pass over it
- [physiology-data.md](physiology-data.md) — the template + instance
  shapes the surfaces in this file read from
- [index.md](index.md) — vitals HUD slot and inspector seam
- [../time.md](../time.md) — hyperspeed wake contract
- [../architecture.md](../architecture.md) — DOM HUD vs Pixi worldspace
  seam (sneeze emote lives on the worldspace side)
