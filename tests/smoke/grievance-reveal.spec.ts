// Issue #144 — grievance/credit queue with lazy in-character reveal.
// Verifies the full loop: a high-weight opinion delta moves opinion at
// action-time (eager state), queues an acknowledgement record, and the
// next talk voices the named deed + swing and clears the queue. Credits
// are thanked for symmetrically; below-threshold deltas queue nothing.

import { test, expect } from './_fixtures'

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.getGameState',
  '__uclife__.applyOpinionDelta',
  '__uclife__.relationToPlayer',
  '__uclife__.characterEntityByKey',
]

test('grievance + credit: eager opinion, lazy reveal on talk, queue clears', async ({ sim }) => {
  await sim.boot({ fixture: 'grievance-talk', requireHandles: REQUIRED_HANDLES })

  // 1. High-weight negative delta → opinion moves immediately, grievance queues.
  const res = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.applyOpinionDelta('kai', -18, '打断了我弟弟的胳膊'),
  )
  expect(res.ok, `applyOpinionDelta failed: ${res.reason}`).toBe(true)
  expect(res.applied).toBe(-18)

  const before = await sim.page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = (window as any).__uclife__.getGameState().getCharacter('kai')
    return { opinion: c.getOpinionOfPlayer(), acks: c.getPendingAcks() }
  })
  expect(before.opinion, 'opinion must move at action-time, not at reveal').toBe(-18)
  expect(before.acks.grievances, 'high-weight delta must queue a grievance').toBe(1)

  // 2. Talk → the NPC voices the named deed and the swing.
  const opened = await sim.page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any
    const npc = w.__uclife__.characterEntityByKey('kai')
    if (!npc) return false
    w.uclifeUI.getState().setDialogNPC(npc)
    return true
  })
  expect(opened, 'could not open NPCDialog for kai').toBe(true)

  const ackSection = sim.page.locator('[data-testid="relation-acks"]')
  await ackSection.waitFor({ timeout: 5_000 })
  const grievanceText = await ackSection.textContent()
  expect(grievanceText, 'reveal line must name the actual deed').toContain('打断了我弟弟的胳膊')
  expect(grievanceText, 'reveal line must show the swing').toContain('关系 -18')

  const afterReveal = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.getGameState().getCharacter('kai').getPendingAcks(),
  )
  expect(afterReveal.grievances, 'grievance queue must clear once acknowledged').toBe(0)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).uclifeUI.getState().setDialogNPC(null))

  // 3. Positive delta → credit, thanked for the same way on the next talk.
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.applyOpinionDelta('kai', 12, '帮我搬了行李'),
  )
  const credited = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.getGameState().getCharacter('kai').getPendingAcks(),
  )
  expect(credited.credits, 'positive delta must queue a credit').toBe(1)

  await sim.page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any
    w.uclifeUI.getState().setDialogNPC(w.__uclife__.characterEntityByKey('kai'))
  })
  await ackSection.waitFor({ timeout: 5_000 })
  const creditText = await ackSection.textContent()
  expect(creditText, 'credit reveal must name the favor').toContain('帮我搬了行李')
  expect(creditText, 'credit reveal must show the positive swing').toContain('关系 +12')
  expect(creditText, 'settled grievance must not re-voice on a later talk')
    .not.toContain('打断了我弟弟的胳膊')

  const afterThanks = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.getGameState().getCharacter('kai').getPendingAcks(),
  )
  expect(afterThanks.credits, 'credit queue must clear once thanked for').toBe(0)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).uclifeUI.getState().setDialogNPC(null))

  // 4. Below-threshold delta moves opinion but queues nothing.
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.applyOpinionDelta('kai', -2, '迟到了'),
  )
  const small = await sim.page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = (window as any).__uclife__.getGameState().getCharacter('kai')
    return { opinion: c.getOpinionOfPlayer(), acks: c.getPendingAcks() }
  })
  expect(small.opinion, 'small delta still moves opinion eagerly').toBe(-18 + 12 - 2)
  expect(small.acks.grievances, 'below-threshold delta must queue nothing').toBe(0)
  expect(small.acks.credits).toBe(0)
})
