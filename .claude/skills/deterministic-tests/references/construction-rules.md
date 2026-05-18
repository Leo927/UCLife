# Construction rules — the why, with worked failure modes

The seven hard rules from SKILL.md, expanded with the original incident or design failure each one defends against. Read this when:

- A test is failing in CI but passing locally (or vice versa).
- A review is bouncing back on "this test is non-deterministic".
- You want to understand why a particular shortcut isn't allowed.

The principle behind all of them: **a correctly-built deterministic test passes 1/1 under any CI load.** If it ever needs "try again", the test is broken — the substrate has the levers to make it 1/1 by construction, you just have to use them.

---

## Rule 1 — Drive through `__uclife__`, not the DOM

Read state from the deterministic handle. Don't assert on rendered text, sprite positions, or Pixi canvas pixels unless the test is explicitly *about* the renderer.

**Why.** React commit is async and batched. A state change followed by a "the UI shows X" assertion races React's render loop. Asserting on `__uclife__.getGameState()` reads ECS state directly — atomic, immediate, no commit race.

**Worked failure mode.** Pre-Phase-5 hire-amuro test asserted on `page.locator('.crew-list-row[data-key="amuro"]').textContent()` to read "captain". The list rendered eventually, but on a hot CI box React batched the commit one frame after the assert. Flake rate: ~5%. Fix: `getGameState().getCharacter('amuro').getHiredRole()` returns `'captain'` immediately after the hire transaction settles, no commit involved.

**Exceptions.** Renderer tests (`portrait*.spec.ts`, `sprite*.spec.ts`) are *about* pixels — they boot with `?test=1&assets=1`, drain via `awaitAssetsReady()`, then assert pixels. That's the only valid carve-out.

---

## Rule 2 — No fixed `sleep` / `waitForTimeout`

Wait on a *condition*, not a clock. `step({ until })` for sim state. `waitForSelector` for DOM mount. Boot-existence `waitForFunction` for module-load.

**Why.** A fixed sleep is a bet against the CI's worst case. If you guess high you waste suite time; if you guess low you flake. The deterministic substrate gives you exact signals — use them.

**Worked failure mode.** `check-scene-swap` pre-migration: `await page.waitForTimeout(3500)` to "let the flight animation finish". On a cold-cache CI run, the dev server's first compile pushed total time to 4.1s — the test asserted on a half-finished transition. Fix: `step({ until: () => getScene().getId() === 'zumCity', maxGameMinutes: 24*60 })`. Exact.

**The legitimate uses.** A *one-shot* `waitForFunction` for the boot-existence check (`typeof window.__uclife_test__?.step === 'function'`) is fine — that's module-load, not sim-state polling. `waitForSelector` for DOM mount is fine — React commit, not sim-state. The boundary: anything reading game-world state with `waitForFunction` is forbidden; anything checking whether modules / DOM nodes exist is fine.

---

## Rule 3 — Drive sim time, not real time

`step({ ... })` is the only way to advance the simulation. Don't click a speed button. Don't `useClock.setSpeed`. Don't run the prod RAF loop.

**Why.** The sim clock is frozen at boot. The prod RAF loop is stopped (`stopLoop()` in `bootTestMode`). The only path that mutates `simNow()` + `useClock.gameDate` + per-tick / per-frame systems is `advanceSimByGameMs()` inside `src/test/clock.ts`. Calling `setSpeed(N)` does literally nothing.

**Worked failure mode.** Pre-migration tests called `setSpeed(8)` then `waitForTimeout(1000)`, expecting 8 game-seconds to elapse. Under the frozen clock, `setSpeed` is a no-op and `waitForTimeout(1000)` advances zero sim ms — the test then asserted on a state change that never happened. Fix: replace with `step({ gameMinutes: 8/60 })` and the consequence's `step({ until })` chase.

**Subtlety: browser RAF is NOT frozen.** Pixi animations driven by `requestAnimationFrame` directly (not the sim loop) still run. `check-scene-swap` exploits this — the flight modal's CSS transition runs to completion in browser-RAF time even though the sim clock isn't ticking. If your assertion depends on a sim-driven consequence, use `step({ until })`. If it depends on a pure-browser animation, `waitForSelector('.transition-done')` is fine.

---

## Rule 4 — Seeded determinism only

Same `seed` + `fixture` → same world. Pin scenario-specific NPCs via `tests/fixtures/<name>.json5` or `src/data/special-npcs.json5`. Don't fish for procedural NPCs by name or position.

**Why.** Procgen rolls under the seeded RNG, but tests that fish for "the first NPC in the bar" or "the NPC at (35, 20)" are betting on the procgen layout. The seed pins the layout, yes, but changing procgen code (or even reordering a system) shifts every downstream roll. Fixture-pinned NPCs are stable across procgen changes.

**Worked failure mode.** Pre-determinism `check-recruit-office` searched for "the first applicant with piloting > 80" via a debug helper. A recruitment refactor changed the eligibility tie-breaking order — same seed, different first applicant — and the test asserted on the wrong NPC's skills. Fix: spawn the applicant via fixture (`npcs: [{ id: 'pilot-test-1', skills: { piloting: 92 } }]`); test reads by `id`.

**The carve-out for `seed` + `setSeed`.** If a test really does want to verify procgen behavior (e.g. "the population system spawns N NPCs in this scene given seed S"), use `seed=…` URL param + `getGameState().getScene()` + count the relevant entities. Just don't reach for specific procedural NPC names.

---

## Rule 5 — No dynamic `await import('/src/...')` from `page.evaluate`

Vite hands the test page a different module instance than the running app. Trait-identity queries silently match nothing.

**Why.** Koota's traits are identity-by-reference — `world.queryFirst(IsPlayer)` checks if the entity has the *exact same `IsPlayer` symbol* as the one registered into the world. Vite serves `/src/ecs/traits.ts` as a separate module to a dynamic import — different `IsPlayer` symbol — query returns empty. No error. Just a silent zero.

**Worked failure mode.** An early Phase 4 draft of the fixture-authority spec did:

```js
const player = await page.evaluate(async () => {
  const traitsMod = await import('/src/ecs/traits.ts')
  const w = window.__uclife__.getWorld('vonBraunCity')
  return w.queryFirst(traitsMod.IsPlayer)   // ← always null
})
```

…and asserted `player !== null`. The assert was the right one, but the query was bypassed by Vite's module duplication. Fix: expose `findPlayerEntity()` on `__uclife__` (or use `getGameState().getPlayerCharacter()`).

**Workaround.** Anything you want to do inside `page.evaluate` that touches a trait or system import needs a helper exposed on `__uclife__` — added in `src/boot/debugHandles.ts` (or `src/test/bootTestMode.ts` for test-only). The page sees the *same* module instance the running app does that way.

---

## Rule 6 — No retry wrappers, no `test.retry(n)`, no swallowing try/catch

If a check needs retries to stay green, the underlying signal is wrong — fix the signal.

**Why.** A "retry until green" pattern hides the real defect. A 5%-flaky test under retry-3 becomes "passes 99.9875% of the time" — and over a 30-test suite, that's still ~0.4% per CI run, or 1 flake per 250 PRs. Real determinism is 1.0 always. Retries are a comfort blanket, not a fix.

**Worked failure mode.** A pre-migration smoke wrapped its asserts in `for (let i = 0; i < 5; i++) try { … ; break } catch { await sleep(500) }`. The actual bug — `EmployedAsCrew` getting reset by a save-handler race — passed the retry maybe 80% of the time on a hot CI box. Took six months and a production-load test to find it. Without the retry, the very first CI red would have surfaced the race.

**The legitimate failure modes that look like flake.** They're not — they're bugs:

- "Sometimes the dialog hasn't opened yet" → `step({ until: () => getDialogue() !== null })` is missing or its `maxGameMinutes` is too low. Fix the step, not the assertion.
- "Sometimes the asset hasn't loaded" → you booted with `assets=1` but forgot `awaitAssetsReady()`. Or an asset pipeline is leaking a job. Fix the pipeline.
- "Sometimes the entity isn't visible on the canvas" → `getEntityScreenCoords` returns null because the scene isn't active or the entity is off-camera. Swap scene first.

---

## Rule 7 — Fail loud, fail fast

Every assertion must produce a message that points at the broken invariant. On failure, dump relevant `__uclife__` state.

**Why.** A CI failure log that says `AssertionError: false === true` tells you nothing. A log that says `player.Money = 30, want 1234 (fixture player.money) — default boot spawn likely shadowing fixture` tells the next engineer where to start.

**Worked failure mode → repaired pattern.** `fixture-authority.spec.ts` was written specifically to catch the silent boot-default shadow bug. The assertion isn't `assert(money === 1234)` — it's:

```js
if (snap.money !== EXPECT_MONEY) {
  failures.push(
    `player.Money = ${snap.money}, want ${EXPECT_MONEY} (fixture player.money) — ` +
    `default boot spawn likely shadowing fixture`,
  )
}
```

The hypothesis (`default boot spawn likely shadowing fixture`) is encoded in the failure message. Anyone reading the CI log goes straight to `bootTestMode`'s player-spawn ordering.

`step({ until })` does this for you automatically — its throw includes the predicate source and a `getGameState()` snapshot. Take advantage: when you're writing your own custom waits or assertions, mirror that shape.

---

## Anti-patterns reference table

| Anti-pattern | Why it's forbidden | Use instead |
|--------------|-------------------|-------------|
| `page.waitForTimeout(N)` | Bet against worst-case CI. No deterministic substrate alternative not available. | `step({ until })` for sim state; `waitForSelector` for DOM. |
| `page.waitForFunction(sim-state)` | Frozen clock — loops forever. | `step({ until })`. |
| `setSpeed(N)` | No-op in test mode. | Delete the line. |
| `test.retry(n)` | Hides bugs. | Find the broken signal, fix it. |
| `try { … assert … } catch { /* swallow */ }` | Same as `test.retry`. | Let it throw. |
| Captured savestates as fixtures | Not diffable, rots with ECS shape, undocumented. | Hand-author JSON5 in `tests/fixtures/`. |
| `element.click()` from `page.evaluate` | Bypasses React synthetic event system. | `page.click(selector)`. |
| Dynamic `await import('/src/...')` | Vite module dedup hands a different instance. | Expose helper on `__uclife__`. |
| Procedural-NPC fishing | Layout shifts under procgen reorderings. | Spawn via fixture, query by `id`. |
| Bespoke `playerSnapshot()`-style debug handles | Drift from current ECS shape; not consolidated. | `getGameState()`. Add the method if it's missing. |

## The escape hatches you can actually pull

Sometimes a test legitimately needs something the runtime API doesn't offer. The valid escape routes:

- **Add a method to `getGameState()`.** Most common. Add it in `src/test/gameStateView.ts`, write a unit test in `gameStateView.test.ts`, use it.
- **Add a domain verb to `__uclife__`.** For state mutation tests that need to drive a system one tick at a time outside the normal RAF cadence (`runAmbitionsTick`, `forceDailyEconomics`, `physiologyTickDay`). Add in `src/boot/debugHandles.ts`.
- **Expose a new debug-handle bridge.** `getEntityScreenCoords` is a model — world-space to screen-space transforms, things `page.evaluate` can't compute on its own. Add in `src/test/`.

What you don't get to do:

- Add `evaluateEvery` to `step` (would change predicate cadence, breaks the design invariant).
- Reach into `useClock.setState` to fast-forward (`advanceSimByGameMs` exists for that, and it drives the per-tick systems your consequence depends on).
- Stash mutable test state on `window` outside the `__uclife__` / `__uclife_test__` namespaces.
