// Issue #143 — Phase 5.3 psychology: cause-tagged events shift opinion via
// dot(causeTags, sympathies) × temperamentScale, and the first talk of each
// game day reveals the next unknown sympathy (highest magnitude first).
// Fixture pins kai's psychology so every expected value is computable;
// exact formula math is covered by src/character/psychology.test.ts.

import { test, expect } from './_fixtures'

const HANDLES = [
  '__uclife_test__.step',
  '__uclife__.getGameState',
  '__uclife__.applyCauseEvent',
  '__uclife__.characterEntityByKey',
  '__uclife__.advanceGameDays',
  '__uclife__.saveGame',
  '__uclife__.loadGame',
  'uclifeUI.getState',
]

/* eslint-disable @typescript-eslint/no-explicit-any */
const psyche = (key: string) => (window as any).__uclife__.getGameState().getCharacter(key)?.getPsyche()

async function openDialog(sim: any, key: string): Promise<void> {
  const opened = await sim.page.evaluate((k: string) => {
    const w = window as any
    const npc = w.__uclife__.characterEntityByKey(k)
    if (!npc) return false
    w.uclifeUI.getState().setDialogNPC(npc)
    return true
  }, key)
  expect(opened, `characterEntityByKey('${key}') must resolve in the active scene`).toBe(true)
}

async function closeDialog(sim: any): Promise<void> {
  await sim.page.evaluate(() => {
    ;(window as any).uclifeUI.getState().setDialogNPC(null)
  })
}

test('psychology: spawn coverage, stance reaction, daily progressive reveal, save round-trip', async ({ sim }) => {
  await sim.boot({ fixture: 'psychology-talk', requireHandles: HANDLES })

  // ── Spawn coverage: pinned values fold; unpinned NPC rolls procgen ──
  const spawned = await sim.page.evaluate(() => ({
    kai: (window as any).__uclife__.getGameState().getCharacter('kai')!.getPsyche(),
    mira: (window as any).__uclife__.getGameState().getCharacter('mira')!.getPsyche(),
  }))
  expect(spawned.kai, 'kai must carry a Psyche').not.toBeNull()
  expect(spawned.kai.temperament).toBe('proud')
  expect(spawned.kai.sympathies.zeonism).toBeCloseTo(0.8)
  expect(spawned.kai.sympathies.pacifism).toBeCloseTo(-0.4)
  expect(spawned.kai.revealed).toEqual([])
  expect(spawned.mira.temperament, 'procgen NPC must roll a temperament').not.toBeNull()
  expect(
    Object.keys(spawned.mira.sympathies).length,
    'procgen NPC must hold ≥1 sympathy',
  ).toBeGreaterThan(0)

  // ── Stance reaction: dot-product formula moves opinion of the actor ──
  const proZeon = await sim.page.evaluate(() =>
    (window as any).__uclife__.applyCauseEvent({ zeonism: 1 }, '公开支持了吉翁的事业'),
  )
  expect(proZeon.ok).toBe(true)
  const kaiReaction = proZeon.reactions.find((r: { npcKey: string }) => r.npcKey === 'kai')
  expect(kaiReaction, 'kai (zeonism +0.8) must react to a pro-Zeon stance').toBeTruthy()
  expect(kaiReaction.applied, 'fitting cause → opinion of the actor rises').toBeGreaterThan(0)
  const opinionAfter = await sim.page.evaluate(() =>
    (window as any).__uclife__.getGameState().getCharacter('kai')!.getOpinionOfPlayer(),
  )
  expect(opinionAfter, 'opinion moves eagerly by exactly the applied reaction').toBeCloseTo(kaiReaction.applied)

  // Antagonized cause: kai holds pacifism -0.4, so a pacifist stance cools him.
  const proPeace = await sim.page.evaluate(() =>
    (window as any).__uclife__.applyCauseEvent({ pacifism: 1 }, '公开呼吁和平'),
  )
  const kaiPeace = proPeace.reactions.find((r: { npcKey: string }) => r.npcKey === 'kai')
  expect(kaiPeace, 'kai (pacifism -0.4) must react to a pacifist stance').toBeTruthy()
  expect(kaiPeace.applied, 'antagonized cause → opinion falls').toBeLessThan(0)

  // ── Reveal 1: first talk of the day surfaces the highest-|weight| cause ──
  await openDialog(sim, 'kai')
  const revealSection = sim.page.locator('[data-testid="psyche-reveal"]')
  await revealSection.waitFor({ timeout: 5_000 })
  expect(
    await revealSection.textContent(),
    'first reveal must voice the highest-magnitude cause (zeonism 0.8)',
  ).toContain('吉翁主义')
  let p = await sim.page.evaluate(psyche, 'kai')
  expect(p.revealed, 'exactly one sympathy revealed per day, highest first').toEqual(['zeonism'])

  // ── Same-day second talk reveals nothing ──
  await closeDialog(sim)
  await openDialog(sim, 'kai')
  p = await sim.page.evaluate(psyche, 'kai')
  expect(p.revealed, 'second talk the same day must not reveal another cause').toEqual(['zeonism'])
  await closeDialog(sim)

  // ── Next game day: the next-highest cause reveals ──
  // Jump the clock a full day (deterministic single set — simulating
  // 1440 game minutes of full-city ticks is wall-clock-prohibitive).
  await sim.page.evaluate(() => (window as any).__uclife__.advanceGameDays(1))
  await openDialog(sim, 'kai')
  await expect(
    revealSection,
    'day-2 first talk must voice the next-highest cause (pacifism 0.4)',
  ).toContainText('和平主义')
  p = await sim.page.evaluate(psyche, 'kai')
  expect(p.revealed, 'day 2 reveals the next-highest cause').toEqual(['zeonism', 'pacifism'])
  await closeDialog(sim)

  // ── Save round-trip: revealed tags + psychology survive load ──
  // Fixture-keyed NPCs don't survive loadGame's reseed-respawn (only
  // npc-imm-*/npc-crew-* keys re-materialize), so this leg drives an
  // authored special NPC — setupWorld always respawns her, and her
  // psychology is authored in special-npcs.json5 (pragmatic, AE 0.9).
  const CHAIR = 'npc-spec-米利亚·卡里'
  await openDialog(sim, CHAIR)
  await sim.page.evaluate(
    (k: string) => {
      const c = (window as any).__uclife__.getGameState().getCharacter(k)
      if (!c?.getPsyche()) throw new Error(`special NPC ${k} must carry a Psyche before save`)
    },
    CHAIR,
  )
  let chair = await sim.page.evaluate(psyche, CHAIR)
  expect(
    chair.revealed,
    'first talk with the AE chair reveals her strongest authored sympathy',
  ).toEqual(['ae_pragmatism'])
  await closeDialog(sim)

  await sim.page.evaluate(async () => { await (window as any).__uclife__.saveGame(1) })
  await sim.page.reload({ waitUntil: 'domcontentloaded' })
  await sim.waitForBoot(HANDLES)
  const loadResult = await sim.page.evaluate(async () => (window as any).__uclife__.loadGame(1))
  expect(loadResult.ok, `loadGame failed: ${JSON.stringify(loadResult)}`).toBe(true)
  chair = await sim.page.evaluate(psyche, CHAIR)
  expect(chair, 'AE chair must still carry a Psyche after load').toBeTruthy()
  expect(chair.revealed, 'revealed tags survive save/load').toEqual(['ae_pragmatism'])
  expect(chair.temperament, 'temperament Effect survives save/load').toBe('pragmatic')
  expect(chair.sympathies.ae_pragmatism, 'sympathy Effects survive save/load').toBeCloseTo(0.9)
})
