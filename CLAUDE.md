# CLAUDE.md

Operating rules for Claude Code in this repo. Architecture description is canonical in `Design/architecture.md` and the `arch/current/*.puml` diagrams — do not duplicate it here.

## Project

UC Life Sim — a browser RPG life simulator set in Gundam UC 0077 lunar city Von Braun. Player-facing language is **zh-CN**; this file, code, comments, commit messages, debug labels, and inspector UI are in English. See `Design/DESIGN.md` for the design index.

License: **GPL-3.0-or-later** (transitively, via the verbatim FC pregmod portrait code in `src/render/portrait/`). Do not strip the content guardrail in `src/render/portrait/adapter/characterToSlave.ts`.

## Commands

```bash
npm run dev                  # Vite dev server, http://localhost:5173 (host:true for LAN)
npm run build                # tsc -b && vite build (auto-runs build:portrait-cache via prebuild)
npm run preview              # serve dist/
npm run build:portrait-cache # rebuild SVG → JSON sprite maps under src/render/portrait/assets/cache/
npm run test:unit            # vitest, pure logic, co-located *.test.ts. CI job `unit`.
npm run ci:local             # smoke / regression. Spawns its own dev server on an ephemeral port.
                             # Sources its step list from .github/workflows/ci.yml (`test` job).
                             # Add --workers 4 for parallel.
```

Type-checking is `tsc -b` (run as part of `npm run build`).

## Reading order for new tasks

1. `Design/DESIGN.md` — design index; follow the one or two links you need.
2. `Design/architecture.md` — what's actually shipped at HEAD (tech stack, multi-world ECS, tick pipeline, pathfinding, save/load, render, smoke-test surface).
3. `arch/current/*.puml` — sequence + component diagrams.
4. The code itself is canon when docs disagree.

## Engineering rules

### TDD is mandatory

Failing test first, then code. Pure logic → `npm run test:unit` (co-located `*.test.ts`). End-to-end behavior → `npm run ci:local`. **Extend the existing layer; do not fork it** — the smoke suite's source of truth is the `test` job in `.github/workflows/ci.yml`. Don't introduce parallel one-off check scripts that live outside it, and don't add unit-test runners to the smoke `test` job. New `check-*.mjs` scripts must read their target URL as `process.argv[2] ?? process.env.UCLIFE_BASE_URL ?? 'http://localhost:5173/'` so the runner can inject the ephemeral port.

Follow *Clean Code* (Robert C. Martin) discipline: small intention-revealing names, small focused functions, single responsibility, composition + injection over globals.

### Smoke-test reliability — non-negotiable

A flaky smoke test is worse than no smoke test: it teaches the team to ignore CI red, and the next real regression slips through. **Reliability is the primary acceptance criterion for any new check-*.mjs / playwright scenario, ranked above coverage breadth.**

Required before a new smoke test can be marked done:

1. **Drive through `__uclife__`, not the DOM.** Read state from the deterministic debug handle. Don't assert on rendered text, sprite positions, or Pixi canvas pixels unless the test is explicitly *about* the renderer.
2. **No fixed `sleep` / `waitForTimeout`.** Wait on a *condition* (`page.waitForFunction(() => __uclife__.something)`). If you reach for `setTimeout(2000)`, expose a deterministic signal on `__uclife__` instead.
3. **Drive sim time, not real time.** Advance the clock via the debug handle (or `superSpeed` / `alwaysHyperspeed` overrides).
4. **Seeded determinism only.** Same `WORLD_SEED` → same world. If a scenario depends on a specific spawn, pin it via `special-npcs.json5` / `scenes.json5` rather than fishing for a procedural NPC.
5. **Soak before merging.** Run the new check 20× back-to-back via `npm run ci:local -- --workers 4`. **20/20 green is the bar.** A 19/20 test will fail every weekday in CI — delete it or fix the root cause.
6. **No retry wrappers, no `test.retry(n)`, no try/catch swallowing.** If a check needs retries to stay green, the underlying signal is wrong — fix the signal.
7. **Fail loud, fail fast.** Every assertion must produce a message that points at the broken invariant. On failure, dump relevant `__uclife__` state to the log.

Do **not** dynamically `await import('/src/ecs/traits.ts')` from a smoke test — it returns a different module instance than the running app. Expose helpers on `__uclife__` instead (see `src/main.tsx`).

If you can't meet these bars for a scenario, **don't add the test** — file the gap as a TODO.

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
- Skill XP reads/writes go through `src/character/skills.ts` (`getSkillXp`, `addSkillXp`, `setSkillXp`). **Do not read the legacy `Skills` trait directly** — its removal is in flight (see *Hot zones* below).
- Modifier `source` strings are namespaced (`'background:soldier'`, `'perk:long-distance'`, `'item:belt'`) so `removeBySource()` stays useful.
- Save round-trip: `serializeSheet()` strips formulas + memo cache; `attachFormulas()` re-seeds on load.

### Engine boundary

`src/engine/` is the staging area for code that will eventually extract into a reusable simulation engine (the project's stated end-state). It may **only** import from `src/ecs/`, `src/stats/`, `src/sim/clock`, `src/sim/events`, and `src/procgen/`. It must **not** import from `src/character/`, `src/data/`, `src/systems/`, `src/render/`, `src/ui/`, or `src/save/`. If a new dependency is needed, hoist the abstraction or stop and discuss before adding it.

### Layered dependency direction

Strict downward only, per `arch/current/001_component_layers.puml`:

```
config → data → procgen → ecs → sim/ai → systems → save/render → ui → boot
```

Upward imports (e.g. `systems/` reaching into `ui/`, or `ecs/` importing `data/`) are bugs, not shortcuts. Fix at design time.

### Refactor discipline

- **Refactors must fully delete obsoleted code** — old files, store flags, dead imports, leftover serializers. No "deprecated" comments left behind.
- **No backwards-compat shims.** Change the call site and delete the old version.
- **No half-merged refactors in working tree.** Either finish in this branch or revert. "Changes not staged" mid-rename is the worst state to leave the repo in.

### Hot zones — refactors in flight

These are *currently* mid-migration. Treat the new API as canonical for new code; leave the old surface alone unless you're the one finishing the migration:

- **`Skills` trait → `StatSheet`.** New code reads/writes XP via `src/character/skills.ts` helpers. The `Skills` trait, its serializer in `src/boot/traitSerializers/economy.ts`, and a handful of UI imports (`StatusPanel.tsx`, `DebugPanel.tsx`, `HRConversation.tsx`, `ShipDealer.tsx`) are pending removal. Check `git status` and ask before editing these — another agent may already have unstaged work.
- **Effect / Modifier unification.** Backgrounds, perks, and conditions are converging onto one `Effect + StatSheet` shape (`Design/characters/effects.md`). New ModTypes `floor` and `cap` exist; physiology condition data is being authored in this shape.
- **Per-trait save handler registry.** `src/save/registry.ts` + `src/boot/saveHandlers/`. Adding a new persisted subsystem = one new file in `saveHandlers/`, no edit to `src/save/index.ts`.

### Parallel agent isolation — mandatory

Every `Agent` call that may modify the working tree (Edit, Write, NotebookEdit, or Bash with mutating commands) **MUST** be spawned with `isolation: "worktree"`. Read-only agents (Explore, claude-code-guide, Plan, audit prompts) MAY run without isolation.

When an isolated agent finishes:

1. The harness returns `{ worktreePath, branch }` (auto-cleaned only if zero changes were made).
2. Inspect with `git -C <worktreePath> log main..HEAD` and `git -C <worktreePath> diff main...HEAD` first.
3. To merge back: `git -C <worktreePath> push -u origin <branch>` then `gh pr create` from that worktree. **Do not merge into `main` without explicit user approval** — surface the PR URL and wait.
4. After merge: `git worktree remove <worktreePath>` and `git branch -d <branch>`.

Send N parallel `Agent` calls in a single message — each gets its own worktree, conflicts surface at PR-merge time. Caveats: worktrees don't isolate dev server ports / browser localStorage / files outside the repo; each gets its own `node_modules` (factor the install cost in); if B depends on A's output, **sequence them**.

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
- Always commit on every iteration; use git for version control on each iteration.
- Keep design docs in sync with shipped behavior.
- Prefer delegating to subagents to maintain context integrity.
- Always prefer MCP server over raw API call.
- Use the plantuml skill to generate diagrams.
