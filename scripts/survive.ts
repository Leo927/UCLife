import { world } from '../src/ecs/world'
import { setupWorld } from '../src/ecs/spawn'
import {
  Character, Vitals, Health, Action, Position, Money, Inventory, IsPlayer, Job, Workstation,
} from '../src/ecs/traits'
import { useClock, formatUC } from '../src/sim/clock'
import { useDebug } from '../src/debug/store'
import { movementSystem } from '../src/systems/movement'
import { npcSystem } from '../src/systems/npc'
import { vitalsSystem } from '../src/systems/vitals'
import { actionSystem } from '../src/systems/action'
import { rentSystem } from '../src/systems/rent'
import { workSystem } from '../src/systems/work'
import { populationSystem } from '../src/systems/population'
import { relationsSystem, topRelationsFor, TIER_LABEL_ZH } from '../src/systems/relations'
import { activeZoneSystem } from '../src/systems/activeZone'

useDebug.getState().setLogNpcs(true)
useDebug.getState().setKeepCorpses(true)
const traceArg = process.argv[3]
if (traceArg) {
  useDebug.getState().setTraceName(traceArg)
  console.log(`[harness] tracing NPC: ${traceArg}`)
}

setupWorld()

for (const p of world.query(IsPlayer)) {
  p.destroy()
}

const days = Number(process.argv[2] ?? 7)
const totalMinutes = days * 24 * 60

console.log(`[harness] starting headless survival sim, ${days} days = ${totalMinutes} game minutes`)
console.log(`[harness] start clock: ${formatUC(useClock.getState().gameDate)}`)

const npcCount = world.query(Character).length
console.log(`[harness] NPCs spawned: ${npcCount}`)

function dumpStatus(label: string) {
  const date = formatUC(useClock.getState().gameDate)
  console.log(`\n=== ${label} @ ${date} ===`)
  for (const e of world.query(Character, Vitals, Health, Action)) {
    const ch = e.get(Character)!
    const v = e.get(Vitals)!
    const h = e.get(Health)!
    const a = e.get(Action)!
    const inv = e.get(Inventory)
    const m = e.get(Money)
    const p = e.get(Position)
    const job = e.get(Job)
    const title = job?.workstation?.get(Workstation)?.jobTitle ?? '无业'
    console.log(
      `  ${ch.name.padEnd(8)} (${title.padEnd(13)}) ` +
      `hp=${h.hp.toFixed(0).padStart(3)}${h.dead ? ' DEAD' : '    '} ` +
      `hung=${v.hunger.toFixed(0).padStart(3)} thir=${v.thirst.toFixed(0).padStart(3)} ` +
      `fat=${v.fatigue.toFixed(0).padStart(3)} hyg=${v.hygiene.toFixed(0).padStart(3)} ` +
      `bor=${v.boredom.toFixed(0).padStart(3)} ` +
      `act=${a.kind.padEnd(8)} ` +
      `meal=${inv?.meal ?? 0} water=${inv?.water ?? 0} $${m?.amount ?? 0} ` +
      `@(${p?.x.toFixed(0)},${p?.y.toFixed(0)})`,
    )
  }
}

dumpStatus('start')

let deathLogged = 0
const STATUS_EVERY_MIN = 360 // dump every 6 game-hours

for (let t = 1; t <= totalMinutes; t++) {
  movementSystem(world, 1)
  // 1 game-min at 1× game speed = 1000 real-ms — feed that to npcSystem
  // so its bucket scheduler advances through one bucket per game-minute,
  // visiting every NPC once per 60-game-min cycle. Matches the previous
  // "step every NPC every game-min" harness behavior closely enough that
  // the long-run survive metric stays comparable.
  npcSystem(world, 1000, 1)
  useClock.getState().advance(1)
  vitalsSystem(world, 1)
  actionSystem(world, 1)
  rentSystem(world, useClock.getState().gameDate.getTime())
  workSystem(world, useClock.getState().gameDate, 1)
  populationSystem(world, useClock.getState().gameDate)
  relationsSystem(world, useClock.getState().gameDate, 1)
  // Headless: cameraStore stays at 0×0 so activeZoneSystem falls through
  // to its "viewport not measured → mark all Active" branch. Calling it
  // ensures newly-spawned immigrants pick up the Active marker too,
  // keeping the BT scheduler off the inactive-coarse cadence.
  activeZoneSystem(world, useClock.getState().gameDate.getTime())

  // Cumulative — counts corpses, since populationSystem replenishes the
  // living population from underneath us.
  let dead = 0
  for (const e of world.query(Health)) {
    if (e.get(Health)!.dead) dead++
  }
  if (dead > deathLogged) {
    deathLogged = dead
  }

  if (t % STATUS_EVERY_MIN === 0) {
    dumpStatus(`t=+${(t / 60).toFixed(1)}h`)
  }
}

dumpStatus('FINAL')
const finalAlive = (() => {
  let n = 0
  for (const e of world.query(Character, Health)) if (!e.get(Health)!.dead) n++
  return n
})()
console.log(`\n[harness] cumulative deaths: ${deathLogged}, living at end: ${finalAlive}`)

console.log(`\n=== RELATIONS @ ${formatUC(useClock.getState().gameDate)} ===`)
let edgeCount = 0
for (const e of world.query(Character, Health)) {
  const h = e.get(Health)!
  if (h.dead) continue
  const ch = e.get(Character)!
  const top = topRelationsFor(e, 3)
  edgeCount += top.length
  if (top.length === 0) continue
  const parts = top.map((r) => {
    const tname = r.target?.get(Character)?.name ?? '?'
    const sign = r.data.opinion >= 0 ? '+' : ''
    return `${tname}(${TIER_LABEL_ZH[r.tier]}, ${sign}${r.data.opinion.toFixed(0)}/${r.data.familiarity.toFixed(0)}, ${r.data.meetCount}x)`
  })
  console.log(`  ${ch.name.padEnd(8)} → ${parts.join(', ')}`)
}
console.log(`[harness] sampled ${edgeCount} edges across living NPCs (top 3 per)`)
