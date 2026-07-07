/**
 * Shared Playwright fixtures for the UC Life Sim smoke / e2e suite.
 *
 * Every spec under `tests/smoke/` imports `test` and `expect` from this file
 * instead of `@playwright/test`. The `sim` fixture replaces the boilerplate
 * that ~40 standalone scripts used to repeat:
 *
 *   - launch browser + context + page (Playwright does this for us)
 *   - install pageerror / console.error listeners
 *   - navigate to `?test=1[&fixture=...]`
 *   - wait for the debug-handle barrier
 *   - tear down on close
 *   - verify no unexpected console errors leaked
 *
 * Boot URL is built per-test via `sim.boot({ fixture, params })`. Tests that
 * tolerate specific console.error patterns (e.g. portrait-missing in skipAssets
 * mode) call `sim.allowConsoleError(predicate)` before booting.
 */
import { test as base, expect, type Page, type ConsoleMessage } from '@playwright/test'

// Anything game-specific (drain rates, fares) stays inline at the assertion
// site — these are test-infrastructure timings only.
export const BOOT_READY_TIMEOUT_MS = 30_000
export const DOM_COMMIT_TIMEOUT_MS = 5_000
// PixiCanvas's Application.init() is async (WebGL context + first render
// pass), so the tactical arena <canvas> attaches well after its React host
// commits. Under parallel-worker contention that init can starve far past a
// DOM-commit budget (observed 2026-07-06: 5s flaked fleet-orders' canvas
// wait while every uncontended run mounts in <1s) — renderer-mount waits
// get their own budget.
export const CANVAS_MOUNT_TIMEOUT_MS = 20_000
export const MS_PER_GAME_MINUTE = 60_000
export const MINUTES_PER_GAME_DAY = 24 * 60
export const SAVE_LOAD_READY_TIMEOUT_MS = 15_000

/**
 * Test-mode (`?test=1` without `&assets=1`) installs empty portrait caches,
 * so any code path that walks the FC pregmod portrait pipeline logs
 * `Missing art resource: <id>`. Expected and non-fatal under skipAssets;
 * any other console.error still trips the suite.
 */
export function isExpectedTestModePortraitMissing(text: string): boolean {
  return text.startsWith('console.error: Missing art resource:')
}

/**
 * Known Pixi v8 renderer teardown race: the auto-render ticker fires one last
 * rAF after Application.destroy() nulls the renderer, so `renderer._resolution`
 * throws. PixiCanvas.tsx calls stop() + destroy() in cleanup, but the already-
 * queued rAF can still land before stop() cancels it. Harmless — the canvas is
 * already torn down. Tests that trigger scene transitions (boardShip, takeHelm,
 * leaveHelm) may encounter this; allowlist via
 * `sim.allowConsoleError(isKnownPixiResolutionTeardown)`.
 */
export function isKnownPixiResolutionTeardown(text: string): boolean {
  return /Cannot read properties of null \(reading '_resolution'\)/.test(text)
}

export type BootOptions = {
  /** Name of a fixture under `tests/fixtures/*.json5`. */
  fixture?: string
  /** Additional URL params (seed, nowMs, assets, etc.). */
  params?: Record<string, string | number>
  /** Override the boot-readiness predicate. Defaults to the `?test=1` barrier. */
  requireHandles?: ReadonlyArray<string>
  /** Override boot timeout. */
  timeoutMs?: number
  /**
   * Boot the production code path (no `?test=1`). For the boot smoke and any
   * test that needs the real procgen / asset pipelines. Default: false (test mode).
   */
  prod?: boolean
}

const DEFAULT_REQUIRED_HANDLES: ReadonlyArray<string> = [
  '__uclife_test__.step',
  '__uclife__.getGameState',
]

/**
 * The handle a spec drives the sim through. Everything funnels through `page`,
 * so anything Playwright supports (locators, screenshots, mouse, keyboard) is
 * still available — `sim` only adds the deterministic-mode verbs.
 */
export class Sim {
  constructor(
    public readonly page: Page,
    private readonly errors: string[],
    private readonly errorAllowlist: Array<(text: string) => boolean>,
  ) {}

  /** Build a `?test=1[&fixture=...]` URL string and navigate to it. */
  async boot(opts: BootOptions = {}): Promise<void> {
    const params = new URLSearchParams()
    if (!opts.prod) params.set('test', '1')
    if (opts.fixture) {
      if (opts.prod) throw new Error('boot({ prod: true, fixture: ... }) — fixtures require test mode')
      params.set('fixture', opts.fixture)
    }
    for (const [k, v] of Object.entries(opts.params ?? {})) params.set(k, String(v))

    const query = params.toString()
    const target = query ? `?${query}` : '/'
    await this.page.goto(target, { waitUntil: 'domcontentloaded' })
    await this.waitForBoot(opts.requireHandles, opts.timeoutMs)
  }

  /**
   * Boot-existence one-shot — the only allowed `waitForFunction`.
   * Sim state is NOT polled this way; a frozen-clock predicate loops forever.
   * Call this after `page.reload()` or any other navigation that doesn't go
   * through `boot()`.
   */
  async waitForBoot(
    requireHandles: ReadonlyArray<string> = DEFAULT_REQUIRED_HANDLES,
    timeoutMs: number = BOOT_READY_TIMEOUT_MS,
  ): Promise<void> {
    await this.page.waitForFunction(
      (paths: ReadonlyArray<string>) => {
        for (const path of paths) {
          const segments = path.split('.')
          let cursor: unknown = window
          for (const seg of segments) {
            // Walk through both objects and functions — zustand store hooks
            // are functions with `.getState`/`.setState` methods on them.
            if (cursor == null || (typeof cursor !== 'object' && typeof cursor !== 'function')) {
              return false
            }
            cursor = (cursor as Record<string, unknown>)[seg]
          }
          if (typeof cursor !== 'function') return false
        }
        return true
      },
      requireHandles,
      { timeout: timeoutMs },
    )
  }

  /**
   * Advance sim time by a fixed number of game minutes.
   * Sole data-only wait primitive — `waitForFunction` over sim state spins
   * forever under the frozen clock.
   */
  async stepFor(gameMinutes: number): Promise<void> {
    await this.page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (m: number) => { await (window as any).__uclife_test__.step({ gameMinutes: m }) },
      gameMinutes,
    )
  }

  /**
   * Coarse idle advance — like stepFor, but advances in large slices instead
   * of the 16ms interactive tick. For long IDLE waits ONLY (e.g. the multi-day
   * ship-delivery lead), where sub-minute fidelity is unneeded and the 16ms
   * tick count (~5.4M/game-day) is wall-clock-prohibitive. Do NOT use while a
   * smooth walk, combat, or space flight is in progress.
   */
  async stepForCoarse(gameMinutes: number): Promise<void> {
    await this.page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (m: number) => { await (window as any).__uclife_test__.step({ gameMinutes: m, coarse: true }) },
      gameMinutes,
    )
  }

  /**
   * Step sim time until predicate returns true, bounded by maxGameMinutes.
   * Predicate runs in the browser context — it can ONLY reach `window.__uclife__`,
   * not outer-scope variables. This is the same closure constraint Playwright
   * imposes on all `page.evaluate` callbacks.
   */
  async stepUntil(
    untilFn: () => boolean | Promise<boolean>,
    maxGameMinutes: number,
  ): Promise<void> {
    await this.stepUntilImpl(untilFn, maxGameMinutes, false)
  }

  /**
   * Coarse variant of stepUntil — advances in large slices (predicate checked
   * once per slice). For ground / UI waits in a heavily-populated scene where
   * fine 16ms stepping is wall-clock-prohibitive. NOT for combat / space flight.
   */
  async stepUntilCoarse(
    untilFn: () => boolean | Promise<boolean>,
    maxGameMinutes: number,
  ): Promise<void> {
    await this.stepUntilImpl(untilFn, maxGameMinutes, true)
  }

  private async stepUntilImpl(
    untilFn: () => boolean | Promise<boolean>,
    maxGameMinutes: number,
    coarse: boolean,
  ): Promise<void> {
    const src = untilFn.toString()
    await this.page.evaluate(
      async ({ src, max, coarse }) => {
        // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
        const until = new Function('return (' + src + ')')() as () => boolean | Promise<boolean>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (window as any).__uclife_test__.step({ until, maxGameMinutes: max, coarse })
      },
      { src, max: maxGameMinutes, coarse },
    )
  }

  /**
   * Allow specific error patterns through the teardown gate. Applies to both
   * `pageerror` (rendered as `<Name>: <Message>`) and `console.error` (rendered
   * as `console.error: <text>`). Call this BEFORE `sim.boot()` if the test
   * path triggers expected errors.
   */
  allowConsoleError(predicate: (text: string) => boolean): void {
    this.errorAllowlist.push(predicate)
  }

  /** Captured page errors + console.error messages (post-allowlist filtering). */
  get unexpectedErrors(): ReadonlyArray<string> {
    return this.errors.filter((e) => !this.errorAllowlist.some((p) => p(e)))
  }

  /** All captured errors, pre-filter — for diagnostic output. */
  get rawErrors(): ReadonlyArray<string> {
    return this.errors
  }
}

type SmokeFixtures = {
  sim: Sim
}

/**
 * Per-spec test runner. Provides `sim` and verifies no console errors leaked
 * on teardown. Use `sim.allowConsoleError(...)` to whitelist expected patterns.
 */
export const test = base.extend<SmokeFixtures>({
  sim: async ({ page }, use, testInfo) => {
    const errors: string[] = []
    const allowlist: Array<(text: string) => boolean> = []

    page.on('pageerror', (e) => errors.push(`${e.name}: ${e.message}`))
    page.on('console', (m: ConsoleMessage) => {
      if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
    })

    const sim = new Sim(page, errors, allowlist)
    await use(sim)

    // Verify error gate. If the test already failed, surface the test failure
    // first (Playwright will mark this and we attach the error log as info).
    const unexpected = sim.unexpectedErrors
    if (unexpected.length > 0) {
      const lines = unexpected.map((e) => '  - ' + e).join('\n')
      await testInfo.attach('page-errors.txt', { body: lines, contentType: 'text/plain' })
      // Only assert if the test would otherwise have passed. If it already
      // failed, the user's assertion message is more useful than ours.
      if (testInfo.status === undefined || testInfo.status === testInfo.expectedStatus) {
        throw new Error(`Unexpected page errors (${unexpected.length}):\n${lines}`)
      }
    }
  },
})

export { expect }
