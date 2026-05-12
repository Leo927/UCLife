import { describe, expect, it } from 'vitest'
import { createWorld } from 'koota'
import {
  Building, Character, EntityKey, Faction, IsPlayer, IsPlayerFaction, Money, Owner, Position,
} from './traits'
import { bootstrapFactions, findFactionEntity } from './ownership'
import {
  createPlayerFaction, findPlayerFaction, hasPlayerFaction, withdrawFromPlayerFaction,
} from './playerFactionCreate'
import { economicsConfig, worldConfig } from '../config'

const TILE = worldConfig.tilePx

function spawnPlayer(world: ReturnType<typeof createWorld>, money: number) {
  return world.spawn(
    IsPlayer,
    Character({ name: 'Player', color: '#fff', title: '主角' }),
    Money({ amount: money }),
    EntityKey({ key: 'player' }),
    Position({ x: 0, y: 0 }),
  )
}

function spawnPlayerOwnedBldg(
  world: ReturnType<typeof createWorld>,
  player: ReturnType<typeof spawnPlayer>,
  typeId: string,
  key: string,
  label: string,
) {
  return world.spawn(
    Building({ x: 0, y: 0, w: 5 * TILE, h: 4 * TILE, label, typeId }),
    Owner({ kind: 'character', entity: player }),
    EntityKey({ key }),
  )
}

describe('createPlayerFaction', () => {
  it('flips the IsPlayerFaction marker on the bootstrapped player faction', () => {
    const world = createWorld()
    bootstrapFactions(world)
    const player = spawnPlayer(world, 10_000)
    expect(hasPlayerFaction(world)).toBe(false)

    const r = createPlayerFaction(world, player)
    expect(r.created).toBe(true)
    expect(r.faction).not.toBeNull()
    expect(r.faction!.has(IsPlayerFaction)).toBe(true)
    expect(hasPlayerFaction(world)).toBe(true)
    expect(findPlayerFaction(world)).toBe(r.faction)
  })

  it('reuses the bootstrapped player Faction entity rather than spawning a new one', () => {
    const world = createWorld()
    bootstrapFactions(world)
    const before = findFactionEntity(world, 'player')!
    const player = spawnPlayer(world, 5_000)

    const r = createPlayerFaction(world, player)
    expect(r.faction).toBe(before)
  })

  it('migrates player-owned building Owner edges into the new faction', () => {
    const world = createWorld()
    bootstrapFactions(world)
    const player = spawnPlayer(world, 8_000)
    const bar = spawnPlayerOwnedBldg(world, player, 'bar', 'bld-bar', '酒吧')
    const shop = spawnPlayerOwnedBldg(world, player, 'shop', 'bld-shop', '商店')

    const r = createPlayerFaction(world, player)
    expect(r.migratedBuildings).toBe(2)
    expect(bar.get(Owner)!.kind).toBe('faction')
    expect(bar.get(Owner)!.entity).toBe(r.faction)
    expect(shop.get(Owner)!.kind).toBe('faction')
    expect(shop.get(Owner)!.entity).toBe(r.faction)
  })

  it('drains the wallet into Faction.fund, leaving the configured stipend on the player', () => {
    const world = createWorld()
    bootstrapFactions(world)
    const player = spawnPlayer(world, 50_000)

    const r = createPlayerFaction(world, player)
    const stipend = economicsConfig.playerFaction.creationStipend
    expect(player.get(Money)!.amount).toBe(stipend)
    expect(r.faction!.get(Faction)!.fund).toBe(50_000 - stipend)
    expect(r.walletMigrated).toBe(50_000 - stipend)
    expect(r.stipendRemaining).toBe(stipend)
  })

  it('caps the stipend at the available wallet when the player is broke', () => {
    const world = createWorld()
    bootstrapFactions(world)
    const stipend = economicsConfig.playerFaction.creationStipend
    const broke = Math.max(0, Math.floor(stipend / 2))
    const player = spawnPlayer(world, broke)

    const r = createPlayerFaction(world, player)
    expect(player.get(Money)!.amount).toBe(broke)
    expect(r.faction!.get(Faction)!.fund).toBe(0)
    expect(r.walletMigrated).toBe(0)
  })

  it('is idempotent — second call is a no-op', () => {
    const world = createWorld()
    bootstrapFactions(world)
    const player = spawnPlayer(world, 30_000)

    const first = createPlayerFaction(world, player)
    const fundAfterFirst = first.faction!.get(Faction)!.fund
    const walletAfterFirst = player.get(Money)!.amount

    const second = createPlayerFaction(world, player)
    expect(second.created).toBe(false)
    expect(second.faction).toBe(first.faction)
    expect(first.faction!.get(Faction)!.fund).toBe(fundAfterFirst)
    expect(player.get(Money)!.amount).toBe(walletAfterFirst)
  })

  it('does not touch faction-owned buildings or other characters\' holdings', () => {
    const world = createWorld()
    bootstrapFactions(world)
    const player = spawnPlayer(world, 5_000)
    const other = world.spawn(
      Character({ name: 'NPC', color: '#888', title: '市民' }),
      EntityKey({ key: 'npc-1' }),
      Position({ x: 10, y: 10 }),
    )
    const npcBar = spawnPlayerOwnedBldg(world, player, 'bar', 'bld-other', '别人的酒吧')
    npcBar.set(Owner, { kind: 'character', entity: other })

    const aeBuilding = world.spawn(
      Building({ x: 0, y: 0, w: 5 * TILE, h: 4 * TILE, label: 'AE复合体', typeId: 'aeComplex' }),
      Owner({ kind: 'faction', entity: findFactionEntity(world, 'anaheim')! }),
      EntityKey({ key: 'bld-ae' }),
    )

    createPlayerFaction(world, player)
    expect(npcBar.get(Owner)!.kind).toBe('character')
    expect(npcBar.get(Owner)!.entity).toBe(other)
    expect(aeBuilding.get(Owner)!.kind).toBe('faction')
    expect(aeBuilding.get(Owner)!.entity!.get(Faction)!.id).toBe('anaheim')
  })
})

describe('withdrawFromPlayerFaction', () => {
  it('transfers fund back to the player wallet, clamped by available fund', () => {
    const world = createWorld()
    bootstrapFactions(world)
    const player = spawnPlayer(world, 20_000)
    createPlayerFaction(world, player)

    const beforeWallet = player.get(Money)!.amount
    const beforeFund = findPlayerFaction(world)!.get(Faction)!.fund
    const moved = withdrawFromPlayerFaction(world, player, 5_000)
    expect(moved).toBe(Math.min(5_000, beforeFund))
    expect(player.get(Money)!.amount).toBe(beforeWallet + moved)
    expect(findPlayerFaction(world)!.get(Faction)!.fund).toBe(beforeFund - moved)
  })

  it('returns 0 when no player faction exists', () => {
    const world = createWorld()
    const player = spawnPlayer(world, 1_000)
    expect(withdrawFromPlayerFaction(world, player, 500)).toBe(0)
  })
})
