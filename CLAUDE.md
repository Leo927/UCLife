# CLAUDE.md

Operating rules for Claude Code in this repo. Architecture description is canonical in `Design/architecture.md` and the `arch/current/*.puml` diagrams — do not duplicate it here.

## Project

UC Life Sim — a browser RPG life simulator set in Gundam UC 0077 lunar city Von Braun. Player-facing language is **zh-CN**; this file, code, comments, commit messages, debug labels, and inspector UI are in English. See `Design/DESIGN.md` for the design index.

License: **GPL-3.0-or-later** (transitively, via the verbatim FC pregmod portrait code in `src/render/portrait/providers/fc-pregmod/`). Do not strip the content guardrail in `src/render/portrait/providers/fc-pregmod/adapter/characterToSlave.ts`.

## Commands

```bash
npm run dev                  # Vite dev server, http://localhost:5173 (host:true for LAN)
npm run build                # tsc -b && vite build (auto-runs build:portrait-cache via prebuild)
npm run preview              # serve dist/
npm run build:portrait-cache # rebuild SVG → JSON sprite maps under public/portrait-cache/
npm run test:unit            # vitest, pure logic, co-located *.test.ts. CI job `unit`.
npm run test:e2e             # playwright test — discovers tests/smoke/*.spec.ts.
                             # Needs an already-running dev server (or playwright.config.ts's
                             # webServer block spawns one on the default port).
npm run lint:arch            # dependency-cruiser — engine boundary + layer direction.
                             # CI job `arch`. Baseline grandfathered; new violations fail.
npm run lint:arch:baseline   # re-snapshot baseline after intentionally fixing violations.
npm run ci:local             # smoke / regression. Spawns its own ephemeral Vite, runs
                             # `playwright test` over tests/smoke/*.spec.ts (filesystem
                             # discovery — no manifest, no ci.yml list), then runs survive.ts.
                             # `npm run ci:local -- --grep portrait` to filter.
                             # `npm run ci:local -- --workers=1` for serial debugging.
                             # `npm run ci:local -- --skip-survive` to drop the long step.
```

Type-checking is `tsc -b` (run as part of `npm run build`).

## Reading order for new tasks

1. `Design/DESIGN.md` — design index; follow the one or two links you need.
2. `Design/architecture.md` — what's actually shipped at HEAD (tech stack, multi-world ECS, tick pipeline, pathfinding, save/load, render, smoke-test surface).
3. `arch/current/*.puml` — sequence + component diagrams.
4. The code itself is canon when docs disagree.

## Engineering rules

### TDD is mandatory

Failing test first, then code. Pure logic → `npm run test:unit` (co-located `*.test.ts`). End-to-end behavior → `npm run ci:local`. **Extend the existing layer; do not fork it** — smoke tests live under `tests/smoke/*.spec.ts` and are auto-discovered by Playwright Test (no manifest, no per-test entry in `ci.yml`). Adding a smoke = drop a `*.spec.ts`. Don't introduce parallel one-off check scripts outside this convention, and don't add unit-test runners to the e2e `test` job.

Follow *Clean Code* (Robert C. Martin) discipline: small intention-revealing names, small focused functions, single responsibility, composition + injection over globals.

### Smoke-test reliability — non-negotiable

A flaky smoke test is worse than no smoke test: it teaches the team to ignore CI red, and the next real regression slips through. **Smoke tests must be deterministic by construction — not statistically reliable.** A correctly-built test passes 1/1 under any CI load. If yours doesn't, the test is broken, not unlucky.

**For new tests, use the deterministic substrate first** — `import { test, expect } from './_fixtures'`, boot via `sim.boot({ fixture: '<name>' })`, advance with `sim.stepFor` / `sim.stepUntil`, assert via `getGameState()`. See the `deterministic-tests` skill (`.claude/skills/deterministic-tests/SKILL.md`) before writing or migrating any test. The rules below are what makes the substrate deterministic; ignoring them is how you get flake.

Reliability is the primary acceptance criterion for any new spec, ranked above coverage breadth.

**Construction rules** — every new smoke test must obey all of these:

1. **Drive through `__uclife__`, not the DOM.** Read state from the deterministic debug handle. Don't assert on rendered text, sprite positions, or Pixi canvas pixels unless the test is explicitly *about* the renderer.
2. **No fixed `sleep` / `waitForTimeout`.** Wait on a *condition* (`sim.stepUntil(...)` for sim state, `page.waitForSelector` for DOM mount). If you reach for `setTimeout(2000)`, expose a deterministic signal on `__uclife__` instead.
3. **Drive sim time, not real time.** `sim.stepFor` / `sim.stepUntil` only. Never click a speed button and wait for the wall clock to catch up.
4. **Seeded determinism only.** Same seed + fixture → same world. If a scenario depends on a specific spawn, pin it via `special-npcs.json5` / `tests/fixtures/<name>.json5` rather than fishing for a procedural NPC.
5. **No dynamic `await import('/src/...')` from inside the page.** Vite hands the test a different module instance than the running app, so trait-identity queries (`world.queryFirst(traitsMod.IsPlayer)`) silently match nothing. Expose helpers on `__uclife__` instead (slices live under `src/boot/debugHandles/`, assembled in `src/bootProd.tsx`).
6. **No retry wrappers, no `test.retry(n)`, no try/catch swallowing.** `playwright.config.ts` pins `retries: 0` — keep it there. If a check needs retries to stay green, the underlying signal is wrong; fix it.
7. **Fail loud, fail fast.** Every `expect` must name the broken invariant. The fixture auto-asserts no unexpected page errors on teardown — don't suppress that gate.

If you can't meet rules 1–7 for a scenario, **don't add the test** — file the gap as a TODO.

### Perf budgets — non-negotiable

Any new (or materially changed) system that touches all entities of a class — NPCs, projectiles, interactables, ships, tiles — per click, per tick, or per frame **requires the following before it can be marked done:**

1. **Stated target N** — the realistic upper bound this system must handle.
2. **Stated perf budget** — a concrete ms/tick or ms/frame target at that N.
3. **Complexity analysis** in the PR/commit description: per-call cost in terms of N, and the structural reason it stays under budget.
4. **Profile output** gated behind a `*_PROF=1` env var (see `HPA_PROF=1` in `src/systems/hpa.ts`).

The agent default is "ship the simplest data structure that compiles" — linear scans, nested loops, recomputing what could be cached. **This default has shipped multiple correctness regressions here** (BT-throttle attempt broke drive interrupts; HPA* short-path fallback masked 100% pathfinding failure). Confront scaling at design time, not after the wall. When in doubt, prefer a battle-tested narrow library (`rbush`, scene-graph hit-testing) over a hand-rolled scan — pull it in *first*, not after.

### Stats and Effects — single channel

Backgrounds, perks, conditions, gear, and skill XP all live on the per-character **`StatSheet`** (`src/stats/sheet.ts`). There is no second modifier engine. See `Design/characters/effects.md` for the data model.

- All stat reads/writes go through `src/stats/sheet.ts` (`getStat`, `setBase`, `addModifier`, `removeBySource`).
- Skill XP reads/writes go through `src/character/skills.ts` (`getSkillXp`, `addSkillXp`, `setSkillXp`).
- Modifier `source` strings are namespaced (`'background:soldier'`, `'perk:long-distance'`, `'item:belt'`) so `removeBySource()` stays useful.
- Save round-trip: `serializeSheet()` strips formulas + memo cache; `attachFormulas()` re-seeds on load.

### Engine boundary

`src/engine/` is the staging area for code that will eventually extract into a reusable simulation engine (the project's stated end-state). It may **only** import from `src/ecs/`, `src/stats/`, `src/sim/clock`, `src/sim/events`, `src/procgen/`, and `src/config/`. It must **not** import from `src/character/`, `src/data/`, `src/systems/`, `src/render/`, `src/ui/`, or `src/save/`. If a new dependency is needed, hoist the abstraction or stop and discuss before adding it.

### Layered dependency direction

Strict downward only, per `arch/current/001_component_layers.puml`:

```
config → data → procgen → ecs → sim/ai → systems → save/render → ui → boot
```

Upward imports (e.g. `systems/` reaching into `ui/`, or `ecs/` importing `data/`) are bugs, not shortcuts. Fix at design time.

Both rules are enforced by `dependency-cruiser` via `npm run lint:arch` (CI job `arch`), with baseline grandfathering: existing violations are listed in `.dependency-cruiser-known-violations.json` and *new* violations fail the build. When you intentionally clear an existing violation, refresh the baseline with `npm run lint:arch:baseline` and commit the change. Do **not** refresh the baseline to make a *new* violation green — fix the import direction instead.

### Refactor discipline

- **Refactors must fully delete obsoleted code** — old files, store flags, dead imports, leftover serializers. No "deprecated" comments left behind.
- **No backwards-compat shims.** Change the call site and delete the old version.
- **No half-merged refactors in working tree.** Either finish in this branch or revert. "Changes not staged" mid-rename is the worst state to leave the repo in.

### Hot zones — refactors in flight

These are *currently* mid-migration. Treat the new API as canonical for new code; leave the old surface alone unless you're the one finishing the migration:

- **Effect / Modifier unification.** Backgrounds, perks, and conditions are converging onto one `Effect + StatSheet` shape (`Design/characters/effects.md`). New ModTypes `floor` and `cap` exist; physiology condition data is being authored in this shape.
- **Per-trait save handler registry.** `src/save/registry.ts` + `src/boot/saveHandlers/`. Adding a new persisted subsystem = one new file in `saveHandlers/`, no edit to `src/save/index.ts`.
- **Deterministic test mode.** Canonical reference: the `deterministic-tests` skill (`.claude/skills/deterministic-tests/SKILL.md`). Load it before authoring, debugging, or migrating any test. Substrate (seeded RNG, `simNow()`, asset-ready barrier, fixture loader, frozen sim clock, `getGameState()` façade) is shipped. Smoke / e2e tests run on **Playwright Test** (`@playwright/test`) — specs live in `tests/smoke/*.spec.ts` and are auto-discovered; the shared `sim` fixture in `tests/smoke/_fixtures.ts` boots `?test=1[&fixture=…]`, gates page errors on teardown, and exposes `sim.stepFor / sim.stepUntil / sim.waitForBoot`. Adding a test = drop a spec file; `ci.yml` and `scripts/ci-local.mjs` know nothing about individual tests. Fixtures stay in `tests/fixtures/*.json5`. The legacy `scripts/check-*.mjs` shape (hand-rolled `chromium.launch`, `node:assert`, `setSpeed + waitForTimeout`) is gone; don't reintroduce it.

### Parallel agent isolation — mandatory

Every `Agent` call that may modify the working tree (Edit, Write, NotebookEdit, or Bash with mutating commands) **MUST** be spawned with `isolation: "worktree"`. Read-only agents (Explore, claude-code-guide, Plan, audit prompts) MAY run without isolation.

When an isolated agent finishes:

1. The harness returns `{ worktreePath, branch }` (auto-cleaned only if zero changes were made).
2. Inspect with `git -C <worktreePath> log main..HEAD` and `git -C <worktreePath> diff main...HEAD` first.
3. To merge back: `git -C <worktreePath> push -u origin <branch>` then `gh pr create` from that worktree. **Do not merge into `main` without explicit user approval** — surface the PR URL and wait.
4. After merge: `git worktree remove <worktreePath>` and `git branch -d <branch>`.

Send N parallel `Agent` calls in a single message — each gets its own worktree, conflicts surface at PR-merge time. Caveats: worktrees don't isolate dev server ports / browser localStorage / files outside the repo; each gets its own `node_modules` (factor the install cost in); if B depends on A's output, **sequence them**.

### No magic number
No number shall be present in code (*.ts). Every single number must be in a config file (json5). Unless given explicit permission by the user.
### Prefer Diegetic
When possible, design game objects to be diegetic — visible, touchable objects inside the game, rather than entries in a menu.

## Conventions

### Code & comments

- Comments are reserved for intention that cannot be inferred from the code directly. Default to no comment.
- Player-facing strings: zh-CN. Everything else (this file, code, comments, debug labels, console logs): English.
- Strong separation of logic, data, and config. The end-state is a reusable engine — design imports accordingly (see *Engine boundary*).

### Content

- Special characters and world content are data-driven in `src/data/*.json5` (`special-npcs.json5`, `scenes.json5`, `world-map.json5`, `flights.json5`). Background/filler NPCs are procedural — generated via `src/data/nameGen.ts` and `src/data/appearanceGen.ts`. Don't add named NPCs to procgen.
- When growing the map/world, prefer expanding the envelope over rearranging existing slots.
- LPC sprites in dev: `vite.config.ts` mounts the sibling `../Universal-LPC-Spritesheet-Character-Generator/spritesheets/` checkout at `/lpc/`. Without that sibling repo, sprites 404 in dev. For prod builds, set `VITE_LPC_BASE_URL`; `src/render/sprite/compose.ts` reads it.

### Procgen gotchas

- **Never spawn NPCs inside luxury / apartment cells** — locked cell doors trap them.
- **Hand-picked tiles** (player spawn, fixed buildings, survival sources) must sit **outside** `procgen.rect` — the road carver doesn't currently know about holes, so anything inside the rect risks colliding with a generated road or building.

### Workflow

- Don't rush to implementation. Refine the design with the user first.
- Always assume a feature has a big scale and lots of content. Ask explicit user permission before implementing naively.
- Commit on every iteration — never leave the working tree dirty between turns.
- Keep design docs in sync with shipped behavior.
- Prefer delegating to subagents to maintain context integrity.
- Always prefer MCP server over raw API call.
- Use the plantuml skill to generate diagrams.
- Always commit your changes
- When resolving a GitHub issue, always create a PR by default.
- After creating a PR, wait until CI passes before considering the work done — subscribe to the PR's CI activity, address any failures, and only report completion once CI is green.
