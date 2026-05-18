import { defineConfig, devices } from '@playwright/test'

// UC Life Sim smoke / e2e suite.
//
// Discovery: every `*.spec.ts` under `tests/smoke/` is picked up automatically.
// No manifest, no ci.yml list — drop a spec file and it runs.
//
// Dev-server lifecycle: when UCLIFE_BASE_URL is set in the env (scripts/ci-local.mjs
// supplies it after binding an ephemeral port) we trust the caller and skip
// `webServer`. Otherwise, Playwright launches `npm run dev` on the standard port
// for ad-hoc `npx playwright test` runs.
//
// Retries are pinned to 0. CLAUDE.md: a flaky smoke is a broken smoke.

const baseURL = process.env.UCLIFE_BASE_URL ?? 'http://localhost:5173/'
const hasExternalServer = Boolean(process.env.UCLIFE_BASE_URL)

export default defineConfig({
  testDir: 'tests/smoke',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  // Asset-heavy renderer-pixel tests (portrait*, sprite*) thrash at >2 workers
  // — the shared Vite dev server serializes SVG/sprite reads under load.
  // 2 workers is the empirically-stable ceiling; bumping further trades
  // reliability for marginal wall-time gain.
  workers: process.env.CI ? 2 : undefined,
  timeout: 60_000,
  expect: { timeout: 5_000 },
  reporter: process.env.CI
    ? [
        ['github'],
        ['list'],
        ['html', { outputFolder: 'playwright-report', open: 'never' }],
        ['junit', { outputFile: 'playwright-report/junit.xml' }],
      ]
    : [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  outputDir: 'scripts/out/playwright',
  use: {
    baseURL,
    viewport: { width: 1280, height: 800 },
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: hasExternalServer
    ? undefined
    : {
        command: 'npm run dev',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
})
