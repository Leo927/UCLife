// Phase 7.0.E.4 — pure hostility check for the guard eject branch. A guard of
// faction `guardFaction` is hostile to a player aligned with `playerFaction`
// when `playerFaction` is listed in the guard faction's enmity row. A neutral
// (unaligned) player has playerFaction === null and is never hostile.
//
// Lives in src/ai/ (the layer the NPC behavior tree lives in) reading only the
// config-layer enmity table, so the guard BT branch never reaches up into
// src/systems/.

export function isHostile(
  guardFaction: string,
  playerFaction: string | null,
  enmity: Record<string, string[]>,
): boolean {
  if (playerFaction === null) return false
  const enemies = enmity[guardFaction]
  if (!enemies) return false
  return enemies.includes(playerFaction)
}
