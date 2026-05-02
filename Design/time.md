# Time & control

| | |
|---|---|
| Real → game ratio | **25 real-min = 24 game-hours** |
| Sim tick | **1 game-minute** (≈ 1 tick / real-second at 1×) |
| Render | 60 fps, interpolated between sim ticks |
| Speeds | pause / 1× / 2× / 4× |

## Commitment-skip mode

When the player commits to a long action (sleep 8h, study 2h, surgery, travel, work shift), simulation runs at max speed (~1 game-second per real ms) until:

- duration completes
- vitals threshold crossed (e.g. injury, contagion)
- scheduled event hits (appointment, contract deadline)
- NPC enters interaction range with high `wants_to_talk` drive
- urgent inbox event arrives
- player cancels

Wakes the player back into normal time at the moment of interruption with a log entry explaining why. NPCs continue to run their AI through skip — when the player returns from sleep, the world has changed.

## Related

- [npc-ai.md](npc-ai.md) — NPC drives that can interrupt commitment-skip
- [characters/index.md](characters/index.md) — vitals thresholds that trigger interruption
- [architecture.md](architecture.md) — tick loop implementation
