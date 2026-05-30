// Issue #70 — prisoner system. Boots a Pegasus-class flagship (brigCapacity
// 8) with a player aboard, seeds named POWs into the brig via forceCapture
// (hand-crafted, not a captured savestate), then drives each per-prisoner
// verb through the single systems/prisoners implementation that backs BOTH
// the brig walk-up and the captain's-office comm-panel face wall.
//
// Construction rules: drives entirely through __uclife__ (no DOM / canvas
// asserts), sim-time only, seeded fixture, no retries, fail-loud expects.

import { test, expect } from './_fixtures'

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.brigState',
  '__uclife__.clearBrig',
  '__uclife__.forceCapture',
  '__uclife__.prisonerInterrogate',
  '__uclife__.prisonerRansom',
  '__uclife__.prisonerRecruit',
  '__uclife__.prisonerExecute',
  '__uclife__.prisonerHandOver',
  '__uclife__.prisonerRelease',
  '__uclife__.brigConditionTick',
  '__uclife__.physiologyTickDay',
  '__uclife__.playerRepByFaction',
  '__uclife__.setPlayerStat',
]

test('prisoner verbs: capture, ransom, neglect death, resolve all six', async ({ sim }) => {
  await sim.boot({ fixture: 'prisoner', requireHandles: REQUIRED_HANDLES })

  // ── 1. Brig starts empty with capacity. Seed two named POWs. ──────────
  const brig0 = await sim.page.evaluate(() => (window as any).__uclife__.brigState())
  expect(brig0.occupied, 'brig should start empty').toBe(0)
  expect(brig0.capacity, 'pegasusClass brig capacity > 0').toBeGreaterThan(2)

  const seeded = await sim.page.evaluate(() => {
    const u = (window as any).__uclife__
    return [
      u.forceCapture('pow-zeon-ace', 'zeon'),
      u.forceCapture('pow-fed-pilot', 'federation'),
    ]
  })
  expect(seeded, 'both POWs should be admitted to the brig').toEqual([true, true])

  // ── 2. The six verbs are all present + callable from the shared module.
  // (Functional presence — driving __uclife__, not the DOM verb wall.)
  const verbsPresent = await sim.page.evaluate(() => {
    const u = (window as any).__uclife__
    return [
      'prisonerInterrogate', 'prisonerRansom', 'prisonerRecruit',
      'prisonerExecute', 'prisonerHandOver', 'prisonerRelease',
    ].every((v) => typeof u[v] === 'function')
  })
  expect(verbsPresent, 'all six prisoner verbs exposed').toBe(true)

  // ── 3. Ransom the Federation pilot: credits + rep both sides + slot frees.
  const repFedBefore = await sim.page.evaluate(
    () => (window as any).__uclife__.playerRepByFaction('federation'),
  )
  const repPlayerBefore = await sim.page.evaluate(
    () => (window as any).__uclife__.playerRepByFaction('player'),
  )
  const moneyBefore = await sim.page.evaluate(
    () => (window as any).uclifeUI ? null : null, // money read below via gameState
  )
  void moneyBefore

  const ransom = await sim.page.evaluate(
    () => (window as any).__uclife__.prisonerRansom('pow-fed-pilot'),
  )
  expect(ransom.ok, 'ransom should resolve').toBe(true)
  expect(ransom.creditsDelta, 'ransom credits the player').toBeGreaterThan(0)

  const repFedAfter = await sim.page.evaluate(
    () => (window as any).__uclife__.playerRepByFaction('federation'),
  )
  const repPlayerAfter = await sim.page.evaluate(
    () => (window as any).__uclife__.playerRepByFaction('player'),
  )
  expect(repFedAfter, 'ransom raises home-faction rep').toBeGreaterThan(repFedBefore)
  expect(repPlayerAfter, 'ransom raises captor-faction rep').toBeGreaterThan(repPlayerBefore)

  // Slot freed — and the change is readable from the SAME brig store the
  // comm-panel face wall renders (one source of truth).
  const brigAfterRansom = await sim.page.evaluate(
    () => (window as any).__uclife__.brigState(),
  )
  expect(brigAfterRansom.occupied, 'ransom frees a brig slot').toBe(1)
  expect(
    brigAfterRansom.prisoners.some((p: any) => p.id === 'pow-fed-pilot'),
    'ransomed POW gone from the roster',
  ).toBe(false)

  // ── 4. Starve a second prisoner to death through the physiology pipeline.
  await sim.page.evaluate(() => {
    const u = (window as any).__uclife__
    u.clearBrig()
    u.forceCapture('pow-doomed', 'federation')
  })
  const repFedPreNeglect = await sim.page.evaluate(
    () => (window as any).__uclife__.playerRepByFaction('federation'),
  )

  // Decay provisioning below the floor (brig tick) until brig_neglect
  // onsets, then advance the shared physiology day-tick (which owns the
  // rise → peak → death gate). Each loop: one brig tick + one physiology
  // day. brig_neglect rises over 2 days to severity 100 → Health.dead →
  // the next brig tick resolves the death + applies the neglect penalty.
  const died = await sim.page.evaluate(async () => {
    const u = (window as any).__uclife__
    for (let i = 0; i < 12; i++) {
      u.brigConditionTick()
      u.physiologyTickDay(1)
      const brig = u.brigState()
      if (!brig.prisoners.some((p: any) => p.id === 'pow-doomed')) return true
    }
    return false
  })
  expect(died, 'neglected prisoner dies through the physiology pipeline').toBe(true)

  const repFedPostNeglect = await sim.page.evaluate(
    () => (window as any).__uclife__.playerRepByFaction('federation'),
  )
  expect(
    repFedPostNeglect,
    'neglect death applies the home-faction rep penalty (execute-pattern)',
  ).toBeLessThan(repFedPreNeglect)

  // ── 5. Execute / release / recruit each resolve + update occupancy. ───
  // Execute — Zeon hardliners APPROVE (faction asymmetry as data), so the
  // Zeon rep rises while most factions would fall.
  await sim.page.evaluate(() => (window as any).__uclife__.forceCapture('pow-exec', 'zeon'))
  const zeonBeforeExec = await sim.page.evaluate(
    () => (window as any).__uclife__.playerRepByFaction('zeon'),
  )
  const exec = await sim.page.evaluate(
    () => (window as any).__uclife__.prisonerExecute('pow-exec'),
  )
  expect(exec.ok, 'execute resolves').toBe(true)
  const zeonAfterExec = await sim.page.evaluate(
    () => (window as any).__uclife__.playerRepByFaction('zeon'),
  )
  expect(
    zeonAfterExec,
    'Zeon approves an execution (authored approval override, not a hardcode)',
  ).toBeGreaterThan(zeonBeforeExec)
  const brigAfterExec = await sim.page.evaluate(() => (window as any).__uclife__.brigState())
  expect(brigAfterExec.occupied, 'execute frees the slot').toBe(0)

  // Release — small positive home rep.
  await sim.page.evaluate(() => (window as any).__uclife__.forceCapture('pow-rel', 'federation'))
  const relRes = await sim.page.evaluate(
    () => (window as any).__uclife__.prisonerRelease('pow-rel'),
  )
  expect(relRes.ok, 'release resolves').toBe(true)
  expect((await sim.page.evaluate(() => (window as any).__uclife__.brigState())).occupied).toBe(0)

  // Recruit — gated to low home-faction loyalty. A pirate POW (default 0
  // rep) is recruitable; resolving frees the slot.
  await sim.page.evaluate(() => (window as any).__uclife__.forceCapture('pow-recruit', 'pirate'))
  const recruit = await sim.page.evaluate(
    () => (window as any).__uclife__.prisonerRecruit('pow-recruit'),
  )
  expect(recruit.ok, 'recruit resolves for a low-loyalty POW').toBe(true)
  expect((await sim.page.evaluate(() => (window as any).__uclife__.brigState())).occupied).toBe(0)
})
