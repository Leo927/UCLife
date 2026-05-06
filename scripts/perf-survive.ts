/**
 * Usage:
 *   npx tsx --import ./scripts/register-raw-loader.mjs scripts/perf-survive.ts \
 *       [npcs=500] [days=7] [mapScale=2]
 *
 * The map size has to be patched on `worldConfig` *before* any system
 * module that captures `mapTilesX/Y` at module-load time (notably
 * pathfinding.ts) is imported — so this script uses dynamic imports.
 *
 * stderr is used for periodic progress so output streams in real time
 * (Node block-buffers stdout when piped to a file, which made the first
 * version of this script appear hung for 13 wall-clock minutes per game-day).
 */

async function main() {
  const NPCS = Number(process.argv[2] ?? 500)
  const DAYS = Number(process.argv[3] ?? 7)
  const MAP_SCALE = Number(process.argv[4] ?? 2)

  // Deterministic Math.random so A/B perf comparisons are apples-to-apples.
  // Without this, NPC wander destinations and chat-line picks diverge across
  // runs — different paths → different deaths → different alive-count →
  // different per-day work. A 5–10% wall-clock spread between runs of the
  // same harness on the same code is normal without seeding. xorshift32 is
  // good enough for randomness and trivially fast.
  let _rng = 0xdeadbeef >>> 0
  Math.random = () => {
    _rng ^= _rng << 13; _rng >>>= 0
    _rng ^= _rng >>> 17
    _rng ^= _rng << 5; _rng >>>= 0
    return _rng / 0x100000000
  }

  // Load worldConfig first and mutate map dimensions BEFORE anything else
  // loads. pathfinding.ts captures COLS_T/ROWS_T at module-load time, so the
  // patch has to land before that module is imported.
  const { worldConfig } = await import('../src/config/world')
  const baseX = 40
  const baseY = 26
  worldConfig.mapTilesX = Math.max(baseX, Math.round(baseX * MAP_SCALE))
  worldConfig.mapTilesY = Math.max(baseY, Math.round(baseY * MAP_SCALE))

  const [
    { world },
    { setupWorld, spawnNPC },
    { Character, Health, IsPlayer },
    { useClock, formatUC },
    { useDebug },
    { movementSystem },
    { npcSystem },
    { vitalsSystem },
    { actionSystem },
    { rentSystem },
    { workSystem },
    { populationSystem },
    { relationsSystem },
    { activeZoneSystem },
    { hpaStats, resetHpaStats },
    { getSceneConfig, initialSceneId },
  ] = await Promise.all([
    import('../src/ecs/world'),
    import('../src/ecs/spawn'),
    import('../src/ecs/traits'),
    import('../src/sim/clock'),
    import('../src/debug/store'),
    import('../src/systems/movement'),
    import('../src/systems/npc'),
    import('../src/systems/vitals'),
    import('../src/systems/action'),
    import('../src/systems/rent'),
    import('../src/systems/work'),
    import('../src/systems/population'),
    import('../src/systems/relations'),
    import('../src/systems/activeZone'),
    import('../src/systems/hpa'),
    import('../src/data/scenes'),
  ])

  const initialScene = getSceneConfig(initialSceneId)
  const replenishment =
    initialScene.sceneType === 'micro' ? initialScene.replenishment : undefined
  if (!replenishment) {
    throw new Error(`perf-survive harness expects scene "${initialSceneId}" to declare replenishment`)
  }
  hpaStats.enabled = process.env.HPA_PROF === '1'

  // Quiet the verbose [social] log — at high N it dominates wall-clock. Don't
  // keep corpses either; high attrition leaks memory and adds iteration cost.
  useDebug.getState().setLogNpcs(false)
  useDebug.getState().setKeepCorpses(false)

  setupWorld()

  for (const p of world.query(IsPlayer)) p.destroy()

  // Deterministic LCG so the test is reproducible: same (npcs, mapScale) →
  // same spawn distribution, names, starting cash. Some will land inside
  // walls — they'll fail pathfinding and starve, which is tolerable for a
  // perf test (the systems we're measuring still exercise).
  const TILE = worldConfig.tilePx
  let rngState = 1
  const rand = () => {
    rngState = (rngState * 1103515245 + 12345) & 0x7fffffff
    return rngState / 0x7fffffff
  }
  for (let i = 0; i < NPCS; i++) {
    const tx = Math.floor(rand() * worldConfig.mapTilesX)
    const ty = Math.floor(rand() * worldConfig.mapTilesY)
    const hue = Math.floor(rand() * 360)
    spawnNPC({
      name: `npc-${i.toString().padStart(4, '0')}`,
      color: `hsl(${hue}, 50%, 50%)`,
      x: tx * TILE + TILE / 2,
      y: ty * TILE + TILE / 2,
      money: 50 + Math.floor(rand() * 200),
      skills: {},
      key: `perf-${i}`,
    })
  }

  console.error(`[perf] map: ${worldConfig.mapTilesX}×${worldConfig.mapTilesY} tiles (${MAP_SCALE}× linear scale)`)
  console.error(`[perf] spawned ${NPCS} pre-placed NPCs (deterministic LCG, seed=1)`)
  console.error(`[perf] start clock: ${formatUC(useClock.getState().gameDate)}`)
  console.error('')
  console.error('[perf]  day  alive  newDeaths  walltime    sim/realtime')
  console.error('[perf]  ---  -----  ---------  ----------  ------------')

  const totalMinutes = DAYS * 24 * 60
  const startTime = performance.now()
  let lastReportTime = startTime
  // setKeepCorpses(false) destroys dead bodies, so we can't count `dead`
  // directly. populationSystem only replenishes when alive < scene target,
  // so above target the alive-delta IS the death count for the day.
  let lastDayAlive = (() => { let n = 0; for (const e of world.query(Character, Health)) if (!e.get(Health)!.dead) n++; return n })()
  const startAlive = lastDayAlive
  let totalDeaths = 0

  // PERF=1 env enables per-system breakdown timing; when off, the timing
  // hooks compile down to nothing extra.
  const PERF_BREAKDOWN = process.env.PERF === '1'
  const sysMs = { mov: 0, npc: 0, vit: 0, act: 0, rent: 0, work: 0, pop: 0, rel: 0, az: 0 }
  const tick = (label: keyof typeof sysMs, fn: () => void) => {
    if (!PERF_BREAKDOWN) { fn(); return }
    const t0 = performance.now()
    fn()
    sysMs[label] += performance.now() - t0
  }

  for (let t = 1; t <= totalMinutes; t++) {
    tick('mov', () => movementSystem(world, 1))
    // 1 game-min at 1× game speed = 1000 real-ms — feeds the bucket
    // scheduler exactly one full cycle per harness iteration so all NPCs
    // think once per game-min.
    tick('npc', () => npcSystem(world, 1000, 1))
    useClock.getState().advance(1)
    tick('vit', () => vitalsSystem(world, 1))
    tick('act', () => actionSystem(world, 1))
    tick('rent', () => rentSystem(world, useClock.getState().gameDate.getTime()))
    tick('work', () => workSystem(world, useClock.getState().gameDate, 1))
    tick('pop', () => populationSystem(world, useClock.getState().gameDate, replenishment))
    tick('rel', () => relationsSystem(world, useClock.getState().gameDate, 1))
    // Headless: cameraStore stays at 0×0 so activeZoneSystem treats the
    // viewport as unmeasured and marks every Character Active, keeping
    // npcSystem out of the inactive-coarse-cadence path.
    tick('az', () => activeZoneSystem(world, useClock.getState().gameDate.getTime()))

    if (t % (24 * 60) === 0) {
      const dayN = t / (24 * 60)
      const now = performance.now()
      const dayMs = now - lastReportTime
      let alive = 0
      for (const e of world.query(Character, Health)) {
        if (!e.get(Health)!.dead) alive++
      }
      // Deaths today = lastAlive - alive (assumes no immigration above
      // the scene's replenishment target, which holds whenever alive ≥ 83).
      const dayDeaths = Math.max(0, lastDayAlive - alive)
      totalDeaths += dayDeaths
      lastDayAlive = alive
      // 1 game-day at 1× speed = 1440 real-sec.
      const realtimeRatio = (dayMs / 1000) / 1440
      const ratioStr = realtimeRatio < 1
        ? `${(1 / realtimeRatio).toFixed(0)}× faster`
        : `${realtimeRatio.toFixed(1)}× slower`
      console.error(
        `[perf]  ${String(dayN).padStart(3)}  ${String(alive).padStart(5)}  ${String(dayDeaths).padStart(9)}  ${(dayMs / 1000).toFixed(2).padStart(6)}s   ${ratioStr}`,
      )
      if (PERF_BREAKDOWN) {
        console.error(
          `[perf]       breakdown(ms): mov=${sysMs.mov.toFixed(0)} npc=${sysMs.npc.toFixed(0)} vit=${sysMs.vit.toFixed(0)} act=${sysMs.act.toFixed(0)} work=${sysMs.work.toFixed(0)} pop=${sysMs.pop.toFixed(0)} rel=${sysMs.rel.toFixed(0)} rent=${sysMs.rent.toFixed(0)} az=${sysMs.az.toFixed(0)}`,
        )
        for (const k of Object.keys(sysMs) as (keyof typeof sysMs)[]) sysMs[k] = 0
      }
      if (hpaStats.enabled) {
        console.error(
          `[hpa]        queries=${hpaStats.queries} thr=${hpaStats.thresholdHits} same=${hpaStats.sameCluster} cross=${hpaStats.crossCluster} ` +
          `flat=${hpaStats.flatMs.toFixed(0)}ms build=${hpaStats.buildMs.toFixed(0)}ms intra=${hpaStats.intraMs.toFixed(0)}ms ` +
          `insert=${hpaStats.insertMs.toFixed(0)}ms abstract=${hpaStats.abstractMs.toFixed(0)}ms refine=${hpaStats.refineMs.toFixed(0)}ms ` +
          `popped=${hpaStats.abstractNodesPopped} succ=${hpaStats.abstractSuccess} fail=${hpaStats.abstractFailures} ` +
          `compFail=${hpaStats.componentFastFail} ` +
          `refDoorless=${hpaStats.refineDoorless} refCheck=${hpaStats.refineCheck} refRebuild=${hpaStats.refineRebuild}`,
        )
        resetHpaStats()
      }
      lastReportTime = now
    }
  }

  const totalMs = performance.now() - startTime
  let finalAlive = 0
  for (const e of world.query(Character, Health)) {
    if (!e.get(Health)!.dead) finalAlive++
  }

  // 1× speed: 1 game-min = 1 real-sec.
  const realtimeBudgetSec = totalMinutes
  const ratio = totalMs / 1000 / realtimeBudgetSec
  const speedup = ratio < 1
    ? `${(1 / ratio).toFixed(1)}× faster than realtime`
    : `${ratio.toFixed(2)}× slower than realtime`

  console.error('')
  console.error('[perf] === FINAL ===')
  console.error(`[perf]   wall-clock total:   ${(totalMs / 1000).toFixed(1)}s`)
  console.error(`[perf]   sim time covered:   ${DAYS} days = ${totalMinutes} game-min`)
  console.error(`[perf]   throughput:         ${Math.round(totalMinutes / (totalMs / 1000))} game-min / real-sec`)
  console.error(`[perf]   vs realtime budget: ${speedup}`)
  console.error(`[perf]   alive at end:       ${finalAlive} (started with ${startAlive})`)
  console.error(`[perf]   total deaths:       ${totalDeaths}`)
  console.error(`[perf]   final clock:        ${formatUC(useClock.getState().gameDate)}`)
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e)
  process.exit(1)
})
