# Saves

- Slot-based + autosave on day-rollover and on commitment-skip start
- Save = `{ rngSeed, clock, allTraits, playerId, version }` serialized via superjson
- Versioned migrations from day 1
- Storage: idb-keyval (IndexedDB)
- Permadeath later = flag that disables save-on-load and deletes slot on death

## Related

- [worldgen.md](worldgen.md) — seeded determinism keeps saves small
- [time.md](time.md) — commitment-skip triggers autosave
- [phasing.md](phasing.md) — permadeath unlocks Phase 4
