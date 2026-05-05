// Architecture rules — keep in lockstep with CLAUDE.md "Engine boundary"
// and "Layered dependency direction" sections.
//
// Run: npm run lint:arch
//
// The strict downward order is:
//   config → data → procgen → ecs → sim/ai → systems → save/render → ui → boot
// Tests (*.test.ts) are exempt from layer rules — tests legitimately import
// across the tree to set up fixtures.

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    // ───────── Engine boundary ─────────
    {
      name: 'engine-boundary',
      severity: 'error',
      comment:
        'src/engine/ is the staging area for the reusable simulation engine. ' +
        'It may only import from src/ecs/, src/stats/, src/sim/clock, src/sim/events, src/procgen/. ' +
        'See CLAUDE.md "Engine boundary".',
      from: { path: '^src/engine/' },
      to: {
        // Block any reach into src/ outside the allow-list. External
        // packages resolve to node_modules/ paths and are filtered by
        // the top-level doNotFollow option, so we only need to fence
        // the in-repo allow-list here.
        path: '^src/(?!engine/|ecs/|stats/|sim/clock|sim/events|procgen/|config/)',
      },
    },

    // ───────── Layer direction (no upward imports) ─────────
    {
      name: 'no-up-from-config',
      severity: 'error',
      comment: 'src/config/ is the lowest layer; it must not import from src/.',
      from: { path: '^src/config/', pathNot: '\\.test\\.ts$' },
      to: { path: '^src/(?!config/)' },
    },
    {
      name: 'no-up-from-data',
      severity: 'error',
      comment: 'src/data/ may only import from src/config/.',
      from: { path: '^src/data/', pathNot: '\\.test\\.ts$' },
      to: {
        path: '^src/(?!config/|data/)',
        // Allow types-only re-exports if they ever appear; depcruise sees
        // type-only imports too, so no special-case needed today.
      },
    },
    {
      name: 'no-up-from-procgen',
      severity: 'error',
      comment: 'src/procgen/ may import from config, data only.',
      from: { path: '^src/procgen/', pathNot: '\\.test\\.ts$' },
      to: { path: '^src/(?!config/|data/|procgen/)' },
    },
    {
      name: 'no-up-from-ecs',
      severity: 'error',
      comment:
        'src/ecs/ must not reach into sim, ai, systems, save, render, ui, or boot.',
      from: { path: '^src/ecs/', pathNot: '\\.test\\.ts$' },
      to: {
        path: '^src/(sim|ai|systems|save|render|ui|boot|debug)/',
      },
    },
    {
      name: 'no-up-from-stats',
      severity: 'error',
      comment: 'src/stats/ is pure math; it must not reach into anything but config.',
      from: { path: '^src/stats/', pathNot: '\\.test\\.ts$' },
      to: {
        path: '^src/(?!stats/|config/)',
      },
    },
    {
      name: 'no-up-from-sim-or-ai',
      severity: 'error',
      comment: 'src/sim/ and src/ai/ must not reach into systems, save, render, ui, or boot.',
      from: { path: '^src/(sim|ai)/', pathNot: '\\.test\\.ts$' },
      to: {
        path: '^src/(systems|save|render|ui|boot)/',
      },
    },
    {
      name: 'no-up-from-systems',
      severity: 'error',
      comment: 'src/systems/ must not reach into save, render, ui, or boot.',
      from: { path: '^src/systems/', pathNot: '\\.test\\.ts$' },
      to: { path: '^src/(save|render|ui|boot)/' },
    },
    {
      name: 'no-up-from-save',
      severity: 'error',
      comment: 'src/save/ must not reach into render, ui, or boot.',
      from: { path: '^src/save/', pathNot: '\\.test\\.ts$' },
      to: { path: '^src/(render|ui|boot)/' },
    },
    {
      name: 'no-up-from-render',
      severity: 'error',
      comment: 'src/render/ must not reach into ui or boot.',
      from: { path: '^src/render/', pathNot: '\\.test\\.ts$' },
      to: { path: '^src/(ui|boot)/' },
    },
    {
      name: 'no-up-from-ui',
      severity: 'error',
      comment: 'src/ui/ must not reach into boot.',
      from: { path: '^src/ui/', pathNot: '\\.test\\.ts$' },
      to: { path: '^src/boot/' },
    },

    // ───────── Hygiene ─────────
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies make load order undefined and break tree-shaking.',
      from: {},
      to: { circular: true },
    },
  ],

  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      mainFields: ['module', 'main', 'types', 'typings'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
    // Vite-only specifiers we don't follow into.
    exclude: {
      path: '\\.(css|json5|svg|png|jpg)$',
    },
  },
};
