# Facilities and ownership (Phase 5.5 — Civilian Faction)

*The city-side faction-management layer. The player owns facilities,
pays salaries and maintenance, recruits members, and runs a small
faction-of-one out of Von Braun before they ever buy a ship.*

## What this layer is for

Phase 6 ships faction management as a fleet/colony arc. Phase 5.5 adds
the **civilian prelude**: the same ownership, payroll, and recruitment
bones, surfaced inside the existing city. A Witness player who never
buys a ship can still run a faction-of-one — own a bar, hire a few
locals, pay them, lose them. A pilot-track player inherits the
abstraction the moment they buy their first ship; nothing is rebuilt
at Phase 6.

This file is the canonical source for the **Faction abstraction**, the
**Owner = Character | Faction** model, the **daily-economics**
contract, and the **realtor / HR-office / faction-office** surfaces.
Phase 6 systems (fleet, colony) extend this layer; they do not
replace it.

## Vocabulary: facility, not building

What worldgen calls "buildings" — the room-bounded structures you can
walk into — are renamed **facilities** when discussed as ownable,
revenue-producing entities. Both names point at the same data; the
rename clarifies that ownership and economics are about the *role*, not
the *geometry*. A facility has one or more **job sites** (the
workplace cell already shipped) and zero or more **bed sites**. Cells
remain the geometric primitive; "facility" is the economic noun.

**The worker on duty is the player's interaction surface for a job
site, not the cell itself.** A job site cell is scenery; clicking it
exposes no verbs. All transactions, services, and owner-side
management at that job site route through the talk-verb on the
embodied worker. This is the universal rule — see
[../DESIGN.md](../DESIGN.md) and
[diegetic-management.md](diegetic-management.md#worker-not-workstation).

## The Faction abstraction

A first-class entity, parallel to a character. A faction holds:

- **Members** — character entities with a `MemberOf(faction)` relation.
  Edges carry rank and per-member loyalty.
- **Leader** — optional. Some factions (Earth Federation) are too
  large to have a single named leader and operate as faceless.
- **Fund** — credits. Pays salaries, maintenance, acquisitions.
- **Income source** — optional. Sponsored factions (canon: AE,
  Federation) receive a fixed daily stipend to flavor solvency.
- **Properties** — owned facilities, owned ships, owned MS.
- **StatSheet + Effects** — same engine as characters
  ([../characters/effects.md](../characters/effects.md)), with a
  faction-scoped schema (`revenueMul`, `salaryMul`, `maintenanceMul`,
  `researchSpeedMul`, `recruitChanceMul`, `loyaltyDriftMul`). The
  daily-economics knobs below fold through it. See
  [research.md](research.md).
- **Unlocks** — `FactionUnlocks: Set<string>`, the faction's binary
  gate set (blueprint ids, facility upgrade ids, ship-class ids).
  Authored by research; consumed by brokers, manage-interactables,
  and Phase 6 procurement gates.
- **Relations** — opinion edges to other factions and to characters.
- **War edges** — a binary `AtWarWith` relation between factions,
  separate from opinion. War status gates encounter behavior.

Faction AI is a deferred slot; emergent NPC-faction behavior (buy /
sell / hire / fire / declare) lands as a separate design pass, not
this one. For Phase 5.5, NPC factions act through scripted seeds:
each game starts with a small set of NPC owners holding the existing
facility stock so the realtor has private inventory from day one.

## Owner = Character | Faction

Every facility has at most one **owner**, of either type. The owner:

- Pays daily **salaries** for occupied job sites.
- Pays daily **maintenance** for the facility itself.
- Receives daily **revenue** from each worked job site.
- Can sell the facility back to the realtor or to a known buyer.

Three default-ownership rules at game start:

1. **Civic facilities** — shops, clinics, parks — default to **state
   ownership** when unowned. State-owned facilities continue to
   operate at baseline (no payroll modeling; the city eats the cost).
   This preserves the genre contract that "the corner store is
   always there." A player can buy a shop *from the realtor's
   state-inventory* and run it for revenue.
2. **Private facilities** — bars, factories, offices, apartments —
   spawn with seeded NPC owners (rich named NPCs and small NPC
   factions). When such a facility goes unowned, it **ceases to
   operate**: workers stop showing up, doors lock, the facility
   appears on the realtor's foreclosure listing.
3. **Faction-misc facilities** — faction office, HR office, research
   lab, MS factory — spawn with their canonical faction owners
   (AE, Federation, Zeon) where appropriate, and otherwise unowned.

## Daily economics

Per **job site**, per day worked:

```
revenue =
  baseRevenue
  × workPerformance               # the worker's existing metric
  × globalRevenueMultiplier       # config knob
  × ownerRevenueMultiplier        # 1.0 for player; <1 for NPC owners
  × factionRevenueMultiplier      # owning faction's modifier
```

Per facility, per day:

```
ownerNet = Σ(job-site revenue) - Σ(salaries) - maintenance
```

The owner pays salaries and maintenance from their fund at end-of-day.
Salaries are per-worker (configured per job-site type and skill tier).
Maintenance is per-facility-type. All numbers live in
`facility-types.json5` and `ownership.json5` — no magic numbers.

The `ownerRevenueMultiplier < 1` for NPCs is deliberate: it caps
runaway NPC-faction wealth without nerfing the player. The player's
1.0 is the design baseline; NPC owners are economically less efficient
than the player by construction. This is hair complexity that the
player will never see, doing real systemic work.

The `factionRevenueMultiplier` resolves to `getStat(faction.sheet,
'revenueMul')` — same channel that research-issued FactionEffects
modify ([research.md](research.md)). No second knob, no ad-hoc field.
The same applies to `salaryMul`, `maintenanceMul`,
`recruitChanceMul`, `researchSpeedMul`, `loyaltyDriftMul` — every
faction-side daily multiplier is one StatSheet read.

## Insolvency: 3-day grace, embodied warning loop

If owner fund is insufficient to pay end-of-day salaries +
maintenance, the facility enters **insolvency**. Three consecutive
insolvent days → ownership reverts to state (for civic types) or to
the realtor's foreclosure listing (for private types).

The warning loop must be **perceivable in the world**, not a silent
counter. Per `diegetic-management.md`, hidden death-states are bugs.

- **Day 1 (insolvency starts):** secretary visits the player at the
  faction office, or — if no faction office exists — sends a
  notification embodied as the *facility's worker* knocking on the
  player's apartment door / approaching the player on the street to
  say "boss, payroll didn't clear." Hyperspeed auto-breaks on this
  event.
- **Day 2:** workers refuse to start their shift. Walking past the
  facility shows it dark, with the same worker waiting outside.
  Hyperspeed auto-breaks on first sight.
- **Day 3:** at end-of-day, ownership reverts. The realtor lists the
  facility the next morning. A newsfeed line announces the
  foreclosure if the facility was named or large enough to matter.

For NPC owners, the insolvency loop runs silently — the realtor's
listing is the player's only signal. NPC factions losing facilities
this way is part of the city's emergent churn.

## Acquisition: the realtor, with embodied sellers

Each district has one **realtor NPC** at a fixed civic facility (the
"realty office"). Realtors handle facilities **in their own district
only** — Von Braun realtors do not list Zum facilities. This is a
real geographic friction: a player operating across districts walks to
each realtor in turn, the same way they walk to each district's bar.

The realtor surface has two modes:

### Flagger mode — private sales

The realtor's listing entries for privately-owned facilities **name
the seller and point at the world location of the seller's body**.
The realtor does not close the deal. The player walks to the seller
(their counter, their office, their apartment) and negotiates via the
existing talk-verb. The seller's persona, opinion of the player, and
fund pressure feed the asking price; `factionRep` and `talk-verb
opinion` can move it. A reluctant seller is a real obstacle.

For seller-facing scale, the realtor also lists the *facility's
location* as a clickable map flag — the player can find the facility
without finding the seller, but cannot buy without finding the seller.

### Direct-seller mode — state and foreclosed inventory

For state-claimed civic facilities, foreclosed properties, and
estates of the deceased, the realtor *is* the seller. The transaction
closes at the realtor's desk. The price is set by formula
(`facility-types.json5`); rep and Charisma move it within a band.

### Apartments are transactional

Residential leases stay one-step at the realtor's desk regardless of
prior ownership. The genre's standing exception — Sims, Stardew, and
Persona all let lease transactions be a checkout — applies. The
emotional weight of "where do I live" is in the *experience of
living there*, not the act of signing.

### Listing categories

The realtor's listing is split for legibility:

- **Residential** — apartments, single beds, dormitories
- **Commercial** — bars, shops, factories, anything revenue-bearing
- **Faction-misc** — offices, research labs, HR offices

Each entry shows: facility name (if named), category, asking price,
seller's name (or "city / foreclosed" for direct-seller inventory),
location flag (clickable → opens map view centered on the facility).

### Selling

The same realtor takes listings from the player. Listed facilities
appear on the realtor's listing for NPC factions to discover via the
deferred faction-AI pass. For Phase 5.5, listed facilities sit until
the player accepts a scripted offer or unlists; the AI pass plugs in
later without a surface change.

## Recruitment

Two paths, plus the existing talk-verb hire surface from
`faction-management.md`.

### Talk-verb hire

The Phase 6 talk-verb hire surface scales down to Phase 5.5 unchanged.
The player chats with any NPC; if **gating** clears (an abstraction —
specific gate is the detail: `factionRep ≥ X`, `opinion ≥ Y`,
`fame ≥ Z`, or any combination per recruiter / faction context), an
"offer to recruit" branch appears on the talk-verb. The NPC's persona
and opinion feed accept-rate; signing bonus pulled from the faction
fund modifies it.

### HR office with a recruiter

A new facility class. One job site occupied by a **recruiter NPC** —
either a hired faction member or an unaffiliated NPC the owner hires
from the open market. The recruiter generates **applications** at
end-of-shift.

**Application generation per shift:**

```
chance = baseRecruitmentChance
       × workPerformance
       × (1.05)^cumulativeNoHireDays
chance = min(chance, recruitmentChanceCap)   # default 0.5
```

On a successful roll, an application is generated and
`cumulativeNoHireDays` resets to 0; a second roll fires immediately
with the reset counter (so a hot recruiter occasionally produces two
in a day). On a failed roll, `cumulativeNoHireDays` increments. All
constants live in `recruitment.json5`.

**Applicant generation** — applicants are *real procgen NPCs*, not
serialized form data. When a roll succeeds:

1. Generate the NPC via the existing `nameGen` + `appearanceGen`
   pipeline.
2. Roll skills and stats from `Uniform[low, high]`, where:
   - `low  = baseRecruitSkill × workPerformance - skillSpan`
   - `high = baseRecruitSkill × workPerformance + skillSpan`
3. Compute quality:
   `Σ skillLevel² + Σ statValue²`
4. Spawn the applicant as an entity at the HR office's lobby. They
   walk in over the next few in-game hours; they sit, idle, or pace.
5. Apply the recruiter's auto-accept filter (set by the player as a
   conversation — see below). Rejected applicants leave; accepted
   applicants become faction members on the spot. Unfiltered
   applicants wait in the lobby until the player visits or the
   application expires.
6. Application expiry is `applicationLifetimeDays` (default 7); on
   expiry, the applicant walks out and despawns.

This is what `diegetic-management.md`'s recruitment-officer pattern
already specified for colonies, applied to a city HR office. The
applicants are bodies the player can right-click (inspector mode),
talk to (talk-verb), and walk past on the street if the office is on
their commute.

**Quadratic quality** rewards depth-of-skill over jack-of-all-trades.
The player is not asked to compute it. The recruiter NPC produces an
**authored zh-CN line** characterizing each applicant ("一个安静的
年轻人，机械方面很专精") drawn from their top skills + persona. The
quality number is invisible UI; it exists only to feed auto-accept
filters.

**Auto-accept as conversation:** the player tells the recruiter what
they're looking for ("机师，至少 30 piloting，亲联邦"). The
recruiter writes it down. Subsequent applicants matching the criteria
are accepted automatically; non-matching ones queue for player
review. There is no filter dialog with sliders.

**Lobby cap:** the HR office has a fixed lobby capacity (default
~12). When full, new applicants are rejected at the door even if
generated — the recruiter is overloaded. This caps the Phase 5.5
NPC budget per office.

## Beds and housing pressure

Each faction member has a **bed claim** — a specific bed entity in a
facility owned by the faction. Members auto-claim available beds at
spawn / recruit-time, preferring beds in their current city. The
player can manually re-assign at any owned bed.

When the **faction's bed count < member count**, all members slowly
lose loyalty / opinion of the faction leader. The drift is
*perceivable*: complaining members surface their state on the
talk-verb ("我们没地方睡，你是不是该买点公寓？"), and the
secretary's "anything gone sideways" verb names it. The mechanical
penalty is a config-driven daily decrement; the *narrative* surface
is where the player learns about it.

Acquiring beds means buying or leasing apartments and dormitory
facilities — the housing pressure pushes the player into the
residential listings, which is otherwise easy to ignore.

## The faction office and the secretary delegate

A **faction office** is a new facility class with a single job site:
the **secretary**. The faction office is the player's late-game
convenience hub. Owning one is optional; running a faction by walking
to each job site every day is a valid play style.

Multiple offices are allowed and useful — one per city the faction
operates in (Von Braun, Zum). The secretary in each office acts on
the local roster (members and facilities in that city only).

### The secretary is a delegate, not a god panel

Per `diegetic-management.md`, a hub-and-NPC must not become a wrapper
around a five-tab UI. The secretary's verbs are short consultative
talks:

- **"Roster the idle members and assign where they fit."** → one
  sentence in, one summary line out, applied. ("已分配 3 人到酒
  吧，2 人到工厂。剩下 1 人没有合适职位。")
- **"Read me the books."** → embodied accounting brief: current
  fund, today's net, three biggest expenses by name, three biggest
  revenue sources by name. Not a ledger screen.
- **"Has anything gone sideways?"** → surfaces the day's warning
  loop: insolvent facilities, unstaffed job sites, members
  complaining about beds, applicants waiting in HR-office lobbies.
- **"Let's restructure."** → the player-faction-creation entry
  point (see below).
- **"I want to declare war / open negotiations with [faction]."**
  → only available after player-faction creation; opens the
  diplomacy verb. Phase 6.4 detail.

Anything denser routes the player to the actual hub:

- Hiring decisions → the recruiter at the HR office.
- Job-site management → walking to the job site (existing surface,
  see below).
- Manufacturing → the factory floor.
- Research → the research lab.

The convenience the secretary provides is **not having to walk to
every facility every day to spot-check status**. She does not become
a panel that lets the player *do* every action remotely.

## Customer-side interaction (any facility)

A customer transacts with the **worker on duty**, never with the
workstation cell. The cashier counter, the clinic desk, the
pharmacist's window, the HR clerk's window, the AE director's
reception, and the realtor's desk all carry **no `Interactable`
trait** — they are scenery rendered via the workstation's chrome
(label, sprite). The talk-verb on the worker is extended with
service branches appropriate to the facility class:

- **Shop / general store** — *buy*, *sell*, *ask about stock*. The
  cashier is the surface. No clerk on shift = no purchases; the
  player sees the dim shopfront and walks away. Charisma still
  modifies prices via the existing channel.
- **Bar** — *order a drink*, *order food*, *tip*, *ask about
  rumors* (gossip channel for [newsfeed.md](newsfeed.md)). The
  bartender is the surface.
- **Clinic** — *get diagnosed*, *get treated*, *fill prescription*.
  The clinician on duty is the surface; see
  [../characters/physiology-ux.md](../characters/physiology-ux.md).
- **Realty office** — listing browse + close-the-sale verbs on the
  realtor (this file's "Acquisition" section).
- **HR office** — applicant lobby + criteria-as-conversation on the
  recruiter (this file's "Recruitment" section).
- **Faction office** — secretary's consultative verbs (this file's
  "secretary delegate" section).

A *closed* facility — outside business hours, on payroll failure
(see "Insolvency"), or after foreclosure — exposes no worker, and
therefore no service. The dark facade is the player-visible signal
that something is broken upstream of the till.

### Civic default staffing

State-owned civic facilities (shops, clinics, public services) staff
a generic procgen worker during their business hours so the
worker-not-workstation rule does not collapse into a friction floor
where the player can't buy bread because the cashier went home five
minutes ago. The staffing is **per-shift**, not always-on: closing
time is real, and "I forgot to buy food before 10pm" is a legitimate
in-world consequence. Specifically:

- Each civic-facility class declares its operating hours in
  `facility-types.json5`.
- During those hours, the workSystem guarantees at least one worker
  on duty at each customer-facing job site. If no faction-assigned
  member is on shift, a generic city-staff procgen NPC is spawned
  and despawned at shift bounds — they are real bodies the player
  can talk to and inspector-mode, not invisible auto-fillers.
- Outside operating hours, the seat is vacant and the facility is
  dark.

Privately-owned facilities make their own staffing decisions through
ownership economics — if the bar owner doesn't hire a bartender, the
bar is closed. That is the intended consequence loop.

## Job-site interaction (player-owned facilities)

When the player owns a facility, owner-side verbs surface on the
**talk-verb of the worker on duty** — the same body the customer
talks to, with extra branches gated by ownership:

- **Inspect** — the worker's persona summary, role-relevant skills,
  performance trend (this is the existing diegetic surface).
- **Fire** — ends the assignment immediately; the NPC walks out.
- **Replace** — auto-pick a fitting idle faction member to take
  over (resolves to the same operation as the secretary's
  `assignIdleMembers`, scoped to this seat).
- **Reassign to specific member** — pick from a list constrained
  to *members currently in the same city as the job site*.

This is the diegetic-correct surface — the player is standing at the
workplace, the NPC is right there, and the conversation is "about
your job." The workstation cell itself remains non-interactive.

When a player-owned job site is **vacant**:

- The cell exposes no verbs.
- The walked-to-it player sees "this seat is empty" via the same
  visual cue as a closed facility (dim, unmanned).
- The hire / assign verb routes through:
  - **Per-facility manage cell** — the local bootstrap. One per
    player-owned facility (see
    [diegetic-management.md](diegetic-management.md#per-facility-manage-cell)).
    "Install someone here" / "assign from local roster" /
    "inspect facility status" all live here.
  - **Secretary** at the faction office — cross-facility roster
    tool. `assignIdleMembers` pulls existing idle members to fill
    seats across the player's facilities. The manage cell is
    local; the secretary is global.
  - **Recruiter** at the HR office — generates a fresh applicant
    over time when no idle member fits.
  - Or the talk-verb hire branch on any civilian in the world.

This preserves the rule: the workstation tile is never an
interaction target. Every owner-side action lives on a body or on
the legitimate manage-cell artifact — the worker, the secretary,
the recruiter, the civilian being recruited, or the owner's own
clipboard.

Bed-site interaction follows the same logic: the player walks to a
bed they own, and if a claimant is sleeping in it, the verbs
("re-assign", "evict") surface as a talk-verb on that NPC. An
unclaimed bed exposes a single "claim for member" verb on the bed
furniture itself — beds are an explicit narrow exception, since
their *purpose* in the sim is the act of claiming, and a bed with no
body to talk to has no other diegetic anchor.

## Player-faction creation

The player-faction does not exist on day one. Until the player
explicitly creates it, **`PlayerFaction.fund` aliases to the player's
wallet** and **`PlayerFaction.facilities` aliases to the player's
owned-facility list.** All ownership economics work; the abstraction
is transparent.

Creation is a dialogue branch on the secretary at the player's
faction office: **"我想正式成立一个 faction."** Confirming:

1. Allocates a `Faction` entity with the player as leader.
2. Migrates ownership of player-owned facilities to the faction
   entity (the alias becomes a real edge).
3. Migrates the wallet to the faction's fund. The player's
   personal wallet from this point is a small "stipend" the
   player draws as a faction member, distinct from the faction
   fund. (Fund withdrawals back to the player's wallet are a
   secretary verb.)
4. Unlocks faction-tier verbs: declare war, open formal
   negotiations, sign treaties — all routed through the secretary
   for now (Phase 6.4 will surface them as council scenes; the
   secretary is the Phase 5.5 stand-in).

The pre-creation aliasing is what avoids the "second wallet on day
one" failure mode. A player who never creates the faction never has
to think about the abstraction.

## What's colony-only (Phase 6.3)

A colony is the only place the player can **build new facilities**
that don't already exist on a city's stock. The realtor surface lists
*existing* facilities; established cities (Von Braun, Zum) do not
expose facility construction. Specifically:

- **Warship slipway** — colony-only. The Phase 6 fleet pipeline
  requires a colony for capital construction.
- **Large MS factory** — colony-only. Small MS retrofit / repair
  is available at Phase 6.2.5 hangar facilities; *production at
  scale* is gated to colonies.
- **Sovereignty** — colonies are not under Federation / Zeon / AE
  oversight. The faction-tier diplomacy verbs (Phase 6.4) require
  this footing.
- **Layout authorship** — the player chooses what to put where in
  a colony, vs. accepting the city's existing facility stock.

The Phase 5.5 city player can run a profitable faction-of-one out of
Von Braun, but cannot produce ships. That economic ceiling is the
nudge that makes the colony arc earn its weight.

## Phasing

| Phase | Scope |
|---|---|
| **5.5.0** | Facility rename in code + data. Owner abstraction (Character \| Faction) under the hood. Existing shops/clinics/parks switch to state-owned default. No new player-facing surface yet. |
| **5.5.1** | Realtor NPC + tabbed listing UI (residential / commercial / faction-misc). Direct-seller close for state / foreclosed inventory. Flagger mode for private sales — realtor names the seller and walks the player to them; closes via a `SellerConversation` branch on the owner's NPC dialog. Apartment + luxury lease/buy stay on the bed-row surface. Seeded NPC owners on bars / factories / private residences from day one (`seedPrivateOwners`). Owner serializer + per-Building EntityKey persist player purchases across save/load. |
| **5.5.2** | Daily economics (revenue / salary / maintenance) on a per-Building `Facility` trait, accumulated by `workSystem` at end-of-shift and rolled up at `day:rollover` (`src/systems/dailyEconomics.ts`). Faction stipends apply to AE / Federation / Zeon `Faction.fund` daily. 3-day insolvency grace counter; day-1 warning surfaces as a named-worker toast + log line, day-2 closes the facility (workers refuse the next shift via `Facility.closedSinceDay`), day-3 reverts ownership to state and re-lists on the realtor. Hyperspeed auto-breaks on each warning leading edge via the new `hyperspeed:break` event. Worker-walks-to-player, dark-facility render, and 'sees the facility for the first time' break are deferred — the toast + log line stand in for the embodied surface until 5.5.3 ships the secretary's "anything gone sideways?" verb. |
| **5.5.3** | Faction office facility + secretary workstation, listed by the realtor as `factionMisc`. Secretary's consultative verbs (`assignIdleMembers`, `assignBeds`, `bookSummary`, `sidewaysReport`) render inside `NPCDialog` when the player talks to the seated secretary; restructure verb is a placeholder until 5.5.5. JobSiteConversation extension on NPCDialog when the player chats up a worker at any player-owned facility — fire / replace-from-idle / pick-from-roster. Bed claims persist via `Bed.claimedBy`; faction-of-one members are derived from player-owned workstation occupancy + owned-bed claims (no formal `MemberOf` relation yet). `housingPressureSystem` runs at `day:rollover` after the economics rollup, decaying `Knows(member→player).opinion` for unhoused members down to a configured floor. |
| **5.5.4** | `recruitOffice` facility class + `recruiter` workstation, listed by the realtor as `factionMisc`. Once seated, the recruiter's criteria-as-conversation chip set + applicant lobby with accept/reject verbs render inside `NPCDialog`. `recruitmentSystem` runs at `day:rollover` after housingPressure: per seated recruiter, rolls the streak-bonused chance from `recruitment.json5`, spawns an `Applicant`-tagged procgen NPC inside the office (capped by `lobbyCapacity`), and expires applicants past `applicationLifetimeDays`. Auto-accept fires on spawn when criteria match. TalkHireConversation extends NPCDialog with an "offer to recruit" branch on civilians (gated by AE rep ≥ `factionRepGate.min` OR target opinion ≥ `opinionGate.min`); accept charges `signingBonus` from the player's wallet. AE-employed and existing player-faction members are filtered out. |
| **5.5.4.5** | Diegetic-correctness sweep. Strip illegitimate cell-as-verb routes from `interactionSystem` for all service-side workstations (shop / clinic / pharmacy / hr / aeReception / manager / secretary / recruiter / buyShip). Service-worker desks become scenery (`noInteractable: true`); customer-side and owner-side verbs route exclusively through the talk-verb on the worker on duty. Per-facility manage cell ships in full: building types declare `hasManageCell: true` (factionOffice, recruitOffice, shop), `spawnBuilding` emits an `Interactable({ kind: 'manage' })` linked back to the building via the new `ManageCell` trait, and `interactionSystem` gates the verb on `Owner.kind === 'character' && Owner.entity === player`. The new `ManageFacilityDialog` (mounted in App.tsx, opened via the `ui:open-manage` sim event) shows the local roster + per-facility books and exposes an "assign idle members to this facility" verb backed by `assignIdleMembersToBuilding`. Bootstrap install for vacant seats works via this surface for any owned facility — no chicken/egg, even before the player owns a faction office. |
| **5.5.5** | Player-faction creation dialogue. Aliasing → real entity migration. Diplomacy / war declaration verbs land as secretary stand-ins for Phase 6.4. |
| **6.3** | Colony adds buildable facility classes (warship slipway, large MS factory). Sovereignty footing. |
| **6.4** | Diplomacy / governance promoted from secretary stand-ins to council-chamber scenes. |

## Related

- [diegetic-management.md](diegetic-management.md) — surface
  discipline; the realtor / HR-office / secretary patterns are
  applications of this file's principles
- [research.md](research.md) — faction-tier progression spine that
  authors FactionEffects + FactionUnlocks, and the research lab as a
  `factionMisc` facility class
- [facility-tiers.md](facility-tiers.md) — owner-side investment
  loop on every facility, gated by research, plugging into the
  daily-economics formulas above
- [faction-management.md](faction-management.md) — Phase 6 fleet /
  colony arc that inherits the abstractions defined here
- [relationships.md](relationships.md) — talk-verb opinion feeds
  recruitment quality and seller asking price
- [../characters/effects.md](../characters/effects.md) — Effect +
  StatSheet engine reused for the FactionStatSheet
- [../characters/skills.md](../characters/skills.md) —
  workPerformance feeds revenue, salary tier, and recruitment
  generation parameters
- [../worldgen.md](../worldgen.md) — facility = the ownable
  projection of the existing building / cell procgen
- [../phasing.md](../phasing.md) — Phase 5.5 sub-phasing
