// Debug-handle manifest. Side-effect imports — each module registers
// its slice of __uclife__ at load time. Adding a new debug-handle
// entry == one line in a cluster file (or one new cluster file + one
// line here), with no edit to main.tsx.
//
// Order is irrelevant: registry rejects duplicate names and assembly
// is a flat Map iteration; no handle reads or writes another handle's
// state at register time.
//
// This whole tree is gated at the import site in main.tsx behind
// `if (import.meta.env.DEV)` so production bundles never see it.

import './world'      // world proxy + player movement / introspection
import './scene'      // useScene / useClock + clock-advance helpers
import './transit'    // airports + transit terminals
import './ambitions'  // ambitions, event log, flags, runAmbitionsTick
import './physiology' // Phase 4 — force-onset, day-tick, diagnose, treatment, getters
import './cheats'     // setPlayerStat + cheatMoney / cheatPiloting / setShipOwned
import './ship'       // boardShip, helm, setCourse, tickSpace, ...
import './combat'     // combat / transition / engagement stores + fastWinCombat
import './save'       // saveGame / loadGame
import './jobs'       // fillJobVacancies — deterministic NPC/workstation setup for smoke tests
