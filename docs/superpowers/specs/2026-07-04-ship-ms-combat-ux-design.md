# Ship / MS / Combat UX — Polish & Overhaul Spec

*2026-07-04. Approved design from a brainstorming pass over the whole ship-management,
MS-management, boarding, warship-combat, and MS-combat experience. Source evidence: six
parallel audits (five code audits vs `Design/fleet.md` / `Design/combat.md` /
`Design/sortie.md` / `Design/post-combat.md`, plus one hands-on Playwright playtest of the
real player path at HEAD).*

## Diagnosis

The machinery is mostly built and sound; the player-facing connective tissue is broken,
hollow, or missing. Every audit independently found the same pattern: systems are complete
and smoke-tested — but only through `__uclife__` debug handles, never through the
walk-and-click path a player uses. CI is green while the loop is unplayable.

Five gap layers, ranked by how badly they break play:

1. **Loop-breaking connective tissue.** Encounters unreachable (24 px contact radius on a
   ~17,000 px map vs moving patrols; courses target stale coordinate snapshots), takeoff
   burns 78 % of max fuel, no reliable way to dock home (autopilot flies to the stale point
   while the course-preview line tracks the live POI), the player secretly owns an unmarked
   boot-granted flagship, frame-mod retrofit is unreachable by construction (depot-only verb
   + ship-only terminal + starter MS stuck aboard), and damaged MS can never be repaired
   (repair system handles ships only).
2. **Hollow command layer.** Active pause commands nothing. CP economy (rally / focus-fire /
   retreat), DP commit, and mid-combat withdraw exist fully in `fleetCommandPoints.ts` with
   zero UI. Fights are auto-fire positioning games that end only in victory or ship death;
   defeat/flee have no post-combat beat.
3. **MS combat genre contradiction.** The designed cockpit minigame
   (Engage/Evade/Suppress/Breach on the mobile-worker primitives) was never built; what
   shipped is direct WASD flight. No hostile MS, no AI MS wings, stakeless ejection — the
   MS gives fewer guns than the bridge and no unique experience.
4. **Unfurnished embodied layer.** Boarding / flagship handoff / helm / dock plumbing works,
   but every non-command room is an empty box; no crew aboard; two competing boarding
   affordances; "negotiate" is a stub toast on the primary combat modal.
5. **Placeholder presentation** where the loop lives: wireframe interiors with clipped
   labels, chevron ships on black void, combat log overlapping the hull readout.

## Decisions locked in this pass

- **Direct-control MS combat is canon.** The shipped WASD/aim model stays; `combat.md` and
  `mobile-worker.md` are amended (see W3.7). The minigame is not built in this pass.
- **Earned ship acquisition.** The boot flagship grant is removed. Players buy their first
  hull at the AE broker; debug `grantFleet` remains the dev/test path.
- **No stopgap hostile respawner.** Hostile spawning arrives later as faction activity (the
  pirate faction dispatches fleets). The static `space-entities.json5` roster stays; do not
  bolt on an RNG or timer respawn.
- **Scope**: all four workstreams below. Everything else goes to the out-of-scope ledger as
  tracked issues.

## Acceptance spine (process fix — applies to every workstream)

Each workstream ends with a **player-path smoke**: a Playwright spec in `tests/smoke/` that
performs the workstream's journey through real input — walking, pressing E on interactables,
clicking DOM buttons. `__uclife__` is used for *reads only* (`getGameState`,
`sim.stepFor` / `sim.stepUntil`, fixture boot). **Debug handles may observe, never drive, in
acceptance smokes.** This rule is added to the `deterministic-tests` skill and `CLAUDE.md`.
Existing debug-driven smokes stay (they test systems); each workstream adds one journey spec
on top.

The capstone journey spec (lands at the end of W1, extended by W2/W3):

> fresh boot → fixture-seeded purse → buy hull at AE broker → walk to hangar, receive
> delivery, board via gate-booth pad → helm → undock → intercept a pirate → fight (W2: with
> orders; W3: sortie an MS) → win or withdraw → tally → dock home → disembark.

This spec is the definition of "the loop works."

Hygiene riding along with W1:

- Fix the red `hud-in-space-view` smoke at HEAD (suspected double `.space-view` mount).
- Fix the Pixi batcher `Cannot read properties of null (reading 'clear')` pageerror that
  fires during combat entry in normal play (currently allowlisted in tests; users see it).
- Delete the orphaned `tests/smoke/_walklag_diag.spec.ts`.

## Workstream 1 — Playable loop

**W1.1 Earned acquisition.** Delete the boot flagship grant (`ecs/spawn.ts:1171`). The AE
broker at the VB airport gains a starter-tier used hull (a worn `lightFreighter` class
variant) priced in `fleet.json5` so steady job income reaches it in a few in-game weeks.
Broker dialogue names the delivery hangar; the existing receive-delivery verb places it.
First purchase emits a log line + toast pointing at the gate booth.

**W1.2 Live-target courses (one fix, two bugs).** Course targets change from coordinate
snapshots to **entity/POI references** re-resolved per tick by the autopilot. Right-clicking
a POI plots a course that stays on the POI; a new **intercept verb** (click an enemy
contact) does the same for hostiles. Contact radius and pursuit behavior move to config with
values sane relative to ship speeds. Pirates within their own detection radius pursue the
player, so encounters also come to you.

**W1.3 Fuel retune.** Takeoff cost, tank sizes, burn rates rebalanced in config.
Budget statement: a standard sortie (undock → intercept → fight → return) uses ≤ 50 % of a
starter tank.

**W1.4 MS custody fixes.** (a) The `msTerminal` scene guard (`interaction.ts:335`) admits
depot hangar scenes, not just `playerShipInterior`. (b) The hangar manager gains an
**unload-to-depot / load-aboard** verb pair (ship ↔ surface hangar at the docked POI),
killing the frame-mod catch-22. (c) Depot MS sprites stop being inert: E opens the retrofit
panel via the now-working terminal path.

**W1.5 MS repair lifecycle.** `damageState` / `repairProgress` land on the `Ms` trait +
`msSchema`; `hangarRepair.ts` gains an MS branch using the already-authored
`repairCostPoints` / `supplyPerRepairDay`. Depot repairs to 100 %; the on-ship repair band
(`onShipRepairCap` / `onShipRepairFloor`) waits for the hangar-boss surface (W4.3). New
fields round-trip on the save handler.

### W1 shipped status

- **W1.1 Earned acquisition — shipped.** Boot flagship grant removed; `lightFreighter`
  buyable at the VB AE rep; buy → delivery → receive → first-hull onboarding (fuel + toast).
- **W1.2 Live-target courses — shipped.** POI/enemy-referenced courses re-resolve per tick;
  `拦截` intercept verb + `aggroContactRadius` engagement modal; patrol pursuit config-ified.
- **W1.3 Fuel retune — shipped.** Takeoff/tank/burn retuned; the short sortie (undock →
  intercept the VB picket → dock home) fits ~half a tank, and the capstone journey now asserts
  the full round trip doesn't strand the ship on fuel.
- **W1.4 MS custody fixes — shipped.** Depot terminal scene guard, unload/load verbs, depot
  MS retrofit path.
- **W1.5 MS repair lifecycle — shipped.** `damageState`/`repairProgress`, hangar-repair MS
  branch, save round-trip.
- **Capstone (Task 10) — shipped, full loop.** `tests/smoke/journey-first-sortie.spec.ts`
  plays the entire W1 loop through real input only (reads via `__uclife__`): buy → wait out the
  delivery → receive → board → helm → intercept → **engage → win on auto-fire → clear
  RecoverablesPanel + CombatTallyPanel → assert money rose → 停泊 dock home → 下船 disembark
  into the city**. Green 12/12 isolated and across both full-parallel `ci:local` runs. Closing
  the loop needed three fixes the original scoping flagged as blockers:
  - **Defeat no longer crashes.** An enemy weapon that destroyed the flagship fired
    `endCombat('defeat')` mid-tick (destroying the flagship entity), then `combatSystem` §6 read
    the dead entity's `Ship` trait (`combat.ts:1636`). Now re-queries the flagship and bails if
    the fight already resolved. Regression: `tests/smoke/combat-defeat.spec.ts`.
  - **Winnable, reachable starter fight.** `pirate-lunar-4` (Char's raider + 2 escorts, a
    1-v-3) no longer covers Von Braun: its aggro is shrunk and it's relocated as fly-out-to
    mid-game content. A single weak `pirateLight` picket (`pirate-lunar-starter`, empirically
    won at ~70% hull) is now the sole VB-covering group and the nearest enemy to the dock.
  - **Picket follows the orbiting dock.** Fixed-coord near-moon patrols were orphaned ~5900px
    from Von Braun by the time a 2-day delivery wait carried the moon ~90° along its orbit. The
    starter now sets `anchorBodyId:'moon'` (EnemyAI orbit anchoring) so it station-keeps on the
    VB approach at all times; the test-mode space tick was also clamped so a coarse idle step no
    longer flings aggroed enemies off-sector.

## Workstream 2 — Command layer

Almost pure UI over shipped backend (`fleetCommandPoints.ts`).

**W2.1 Order palette on active pause.** Pausing (Space) opens a command strip in the
tactical view: rally-to-point, focus-fire target, formation change, MS launch authorization,
fleet retreat — each routed through the existing `issueFleetOrder`, debiting CP per the
existing `orderCosts` config. Orders also issuable unpaused. Target-taking orders enter a
click-target mode on the arena. Out of CP → refusal toast + existing 指挥点耗尽 log line;
fleet falls back to doctrine.

**W2.2 CP gauge + log de-spam.** Persistent CP gauge in the tactical HUD. The per-point
CP-regen info log line is removed (redundant once the gauge exists).

**W2.3 Mid-combat withdraw.** Retreat verb in the topbar and order palette →
`endCombat('flee')` + `applyFleePenalty`. The pre-combat engagement modal states flee
consequences on the button (currently a silent 35 % hull / all armor / half CR hit).
Penalty magnitudes reviewed and kept in visible config.

**W2.4 DP commit in the war room.** War-room panel grows the deployment view: DP cap
(`computeDpCap`), per-ship/MS `dpCost` chips, commit toggles via `commitShipToEngagement`.
Empty commit set still deploys everything (existing back-compat).

**W2.5 Manual fire control, minimal.** Weapon rows become clickable: auto / hold /
manual-volley per mount (manual = fire when charged, at the aim cursor). The dead
`selectedMountIdx` state is wired or deleted. Deliberately not Starsector
weapon-groups-with-flux-venting.

**W2.6 Non-victory post-combat beats.** Defeat and flee get a minimal debrief panel on the
tally infrastructure: losses (hull damage, crew casualties, flee penalty, captured crew),
current location, continue. Victory keeps recoverables → tally.

Also here: fix the combat log overlapping the player status panel in `TacticalView.tsx`.

### W2 shipped status

- **W2.1 Order palette — shipped.** Flagship-only command strip in `TacticalView.tsx`
  (`OrderPalette`): 集结 (rally), 集火 (focusFire), 重整队形 (regroup → `formationChange`
  cost), 撤退 (withdraw). Rally/focus-fire arm a click-target mode on the arena
  (`orderPickRadiusPx`); regroup is one-shot. All routed through `issueFleetOrder`, debiting
  the `orderCosts` config. Orders issue **while paused** (the pause is the planning moment) and
  unpaused. Out of CP → `指挥点不足` refusal toast, standing fleet-order state untouched, fleet
  falls back to doctrine. Coverage: `tests/smoke/fleet-orders.spec.ts` (backend effects +
  real-input palette).
- **W2.2 CP gauge — shipped.** Persistent 指挥点 `current/max` readout in the tactical topbar,
  carrying `data-tactical-cp="current/max"`; the read-only `getCombat().getCommandPool()` view
  mirrors `commandPoolDescribe()`. The per-point CP-regen info log line was removed.
- **W2.3 Mid-combat withdraw — shipped.** 撤退 in the topbar + palette → `endCombat('flee')` +
  `applyFleePenalty`; flee consequences stated on the pre-combat modal button. Coverage:
  `tests/smoke/combat-withdraw.spec.ts`.
- **W2.4 DP commit in the war room — shipped.** War-room deployment view: DP cap, per-ship/MS
  `dpCost` chips, commit toggles; empty commit still deploys everything. Coverage:
  `tests/smoke/war-room-dp.spec.ts`.
- **W2.5 Manual fire control — shipped.** Per-mount fire modes (auto / hold / volley); volley
  fires when charged at the aim cursor. Coverage: `tests/smoke/fire-control.spec.ts`.
- **W2.6 Non-victory post-combat beats — shipped.** Defeat and flee share one debrief beat on
  the tally infrastructure (losses, location, continue); modal flee and mid-combat withdraw
  route through the same flee resolution. Victory keeps recoverables → tally.
- **Combat-log overlap — fixed.** `.combat-log` no longer covers `.tactical-hud-player`;
  regression-guarded at the default and a small (1024×600) viewport in `fleet-orders.spec.ts`.
- **Capstone (Task 8) — shipped.** `tests/smoke/journey-first-sortie.spec.ts` gained a minimal
  real-input command-layer leg: during the first-contact pause it reads CP via
  `getCombat().getCommandPool()`, arms 集火 through its palette button, clicks the sole enemy
  (`enemy-ship-0`) at its projected arena coords, asserts CP debited by exactly
  `orderCosts.focusFire`, then presses Space to resume into the existing auto-fire win.

**Locked deviations from the W2 plan:**

- **MS launch authorization deferred to W3.** The order palette ships **without** the
  `msLaunchAuth` order (`orderCosts.msLaunchAuth` stays in config, unused by the palette). MS
  launch authorization lands with W3's MS combat identity, where hostile/AI MS wings give it
  something to authorize. The palette is four orders: rally, focus-fire, regroup, withdraw.
- **Withdraw is CP-free.** 撤退 is always enabled, carries no `orderCosts` row, no CP gating,
  and no disabled/tooltip state — a fleet can always disengage regardless of command-point
  exhaustion. It is deliberately not a `issueFleetOrder` CP spend.

**Scope notes:**

- **Volley is target-picked, not a fire group.** Manual-volley fires the charged mount at the
  current aim cursor — it is not Starsector-style weapon-groups-with-flux-venting. The dead
  `selectedMountIdx` state was resolved along the way.
- **Fire modes are bridge controls.** A mount's mode toggle and volley trigger only accept real
  input while the player pilots the **flagship** (mirroring `OrderPalette`'s comm-authority
  gate): `combatSystem` §3 forces every mount to `auto` the instant the player isn't at the
  flagship helm (the AI flagship fires all charged guns). The weapon queue stays visible but
  read-only in that state, for situational awareness.

## Workstream 3 — MS combat identity

**W3.1 Distinct flight model.** Per-frame handling in `ms-classes.json5`: much higher
thrust-to-mass than ships, a vernier boost (short dash, cooldown, drinks propellant),
tighter turn, smaller hit profile. Ships stay heavy and inertial.

**W3.2 Hostile MS + pilots.** Enemy MS frames join the data (pirate-grade junker frames
now; Zeon/Federation frames are wartime content). Hostile groups in `space-entities.json5`
gain MS complements that launch from carrier hulls or patrol independently. Each hostile MS
carries a pilot stat block driving AI quality (aim lead, boost usage, disengage sense).

**W3.3 AI MS wings.** MS with assigned pilots launch as wings via the MS
launch-authorization order on the W2 order palette (comm-panel routing stays out of scope,
ledger #6) through the existing hangar-door queue; wing AI flies escort/intercept per role, uses the existing sortie-resource drain,
auto-docks to resupply when dry. **Role tags** land here as the wing-AI behavior selector
(skirmisher / fire-support / anti-MS / anti-ship): data field on the `Ms` instance + UI on
the retrofit panel + AI consumer, together.

**W3.4 Cockpit HUD.** While piloting: propellant, per-weapon ammo, life-support gauges;
boost cooldown; resupply progress timer when docked; one-line flagship status sliver
(hull % + AI stance).

**W3.5 Ejection with stakes.** Player MS at hull 0: auto-pause + eject confirm (per the
designed auto-pause set). Eject spawns a drifting pod; recovery reuses the tug pattern
(friendly recovery vs hostile capture window). Permadeath on = survival roll; off = injury
arc through physiology. NPC pilots get the same pod fate roll. **Life support gains its
consequence:** at zero, forced ejection.

**W3.6 Crew-driven resupply.** The resupply formula's placeholder constants
(`defaultHangarBossPerformance`, fixed crew count) move behind one config flag now and wire
to the real hangar boss + mechanic crew when W4.3 lands.

**W3.7 Doc amendment.** `combat.md` rewrites Cockpit mode around direct control and strikes
"the minigame primitive model is the ceiling" and the twin-stick prohibition.
`mobile-worker.md` keeps the civilian MW minigame as future Phase 5.4 content but loses the
"rehearsal becomes the fight" through-line. The `mw_pilot` ambition-verb gap gets a
tracking issue (see ledger).

## Workstream 4 — Embodied ship + presentation

**W4.1 Crew live aboard.** Hired crew NPCs seed into the flagship interior with on-duty
schedules: stations underway, mess/quarters/off-duty otherwise. Same BT/drives as city NPCs.

**W4.2 Furnished rooms.** `crewQ`, `mess`, `medbay`, `engineRoom` gain interactables in
`ship-classes.json5`: player bed (sleep), mess verb (eat), crew-usable equivalents for the
schedules above. Ship bar only if the room template already has space.

**W4.3 Hangar boss + on-ship hangar deck.** One hired crew member holds the hangar-boss
role, seeded in the hangar bay. His talk-verb opens the on-ship hangar deck surface: MS
aboard, forward-repair priority within the `onShipRepairCap` / `onShipRepairFloor` band
(completes W1.5), load/unload verbs from W1.4 surfaced diegetically at dock. His and his
crew's real stats replace the resupply placeholders (completes W3.6).

**W4.4 One boarding affordance.** Delete the legacy airport `boardShip` kiosk
(`ecs/spawn.ts:659–668`); the hangar gate-booth board pad is the only airlock. The
captain's-office readiness panel gains the missing launch-blocking lines: crew slots
filled, MS loaded, pilots assigned.

**W4.5 Diegetic seams.** In-world "leave the helm / leave the bridge" verb on the bridge
seat (overlay button stays as shortcut). `climbIntoMs` outside combat opens the retrofit
terminal instead of a rejection toast. **Negotiate de-stubs minimally:** pirates demand a
credits toll — pay and they disengage, refuse and it's the fight; cost scales in config.

**W4.6 Presentation floor.** Ship-interior label layout fix (clipped/overlapping labels),
tactical arena gets a starfield + per-class ship sprites instead of chevrons, tally
loot-line formatting fix. Explicitly *not* an art pass on the city.

## Ordering and shippability

W1 → W2 → W3 → W4. Each workstream is independently shippable and leaves the game strictly
better; each ends with its player-path smoke green plus the standard gates
(`test:unit`, `ci:local`, `lint:arch`, `tsc -b`). Cross-workstream deferrals are explicit:
W1.5 → W4.3 (on-ship repair band), W3.6 → W4.3 (resupply crew wiring).

## Perf notes (per CLAUDE.md budget rule)

New or changed per-tick work, with target N and structural cost:

- **Live-target course re-resolution (W1.2):** O(ships in transit) per tick, N ≤ ~30 fleet
  ships + ~15 hostile groups; one position lookup + vector per ship. Budget: < 0.1 ms/tick.
- **Pirate pursuit (W1.2):** O(hostile groups) distance checks per tick against the player
  ship only, N ≤ ~15. Budget: < 0.05 ms/tick. No spatial index needed at this N.
- **Wing AI (W3.3):** O(MS in tactical), N ≤ ~16 (DP-capped); same per-entity cost class as
  the existing escort-ship AI in `combat.ts`. Budget: within the existing combat tick
  budget; profile via the existing combat profiler env var.
- **Crew schedules aboard (W4.1):** existing NPC BT at game-tick rate, N ≤ crew size
  (~20–220 by class); same system that already runs city NPCs — no new scaling class.

All tunables introduced by this spec (prices, radii, fuel rates, boost params, toll costs,
penalty magnitudes, order costs) live in config json5, never inline.

## Out-of-scope ledger (file as tracking issues when implementation starts)

1. Faction-driven hostile spawning (pirate faction dispatches fleets; replaces any respawn
   temptation).
2. Enemy boarding / Breach mechanic (the missing auto-pause trigger; would make the
   walkable interior matter in combat).
3. Encounter generator + strategic-war-driven encounter pressure.
4. MW civilian minigame + `mw_pilot` ambition verb.
5. Sell-ship / scrap / fleet-termination arc (roster scrap button is currently a stub
   toast).
6. Comm-panel multi-face wall (full diegetic-management design).
7. Walkable escort interiors / per-escort management (Phase 6.3).
8. Standalone drydock scene (currently a hidden region inside `vonBraunCity`).
9. Five-channel doctrine depth beyond the aggression slider.
10. City presentation / spawn-area art (black-void first impression).
