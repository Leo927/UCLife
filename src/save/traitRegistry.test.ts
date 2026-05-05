import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createWorld, trait, type Entity } from 'koota'
import {
  __resetTraitSerializersForTests,
  getTraitSerializers,
  registerTraitSerializer,
  type RestoreCtx,
  type SerializeCtx,
} from './traitRegistry'

const Position = trait({ x: 0, y: 0 })
const Health = trait({ hp: 100, dead: false })
const Home = trait(() => ({ bed: null as Entity | null }))

const noopCtx: SerializeCtx = { keyOf: (e) => (e ? `entity-${e}` : null) }

const restoreCtx = (resolve: (k: string | null) => Entity | null): RestoreCtx => ({
  resolveRef: resolve,
  version: 7,
})

describe('traitRegistry', () => {
  beforeEach(() => __resetTraitSerializersForTests())
  afterEach(() => __resetTraitSerializersForTests())

  it('registers a serializer and surfaces it via getTraitSerializers', () => {
    registerTraitSerializer({
      id: 'position',
      trait: Position,
      read: (e) => ({ ...e.get(Position)! }),
      write: (e, v) => e.set(Position, v),
    })
    expect(getTraitSerializers()).toHaveLength(1)
    expect(getTraitSerializers()[0].id).toBe('position')
  })

  it('rejects duplicate ids — the on-disk shape would collide', () => {
    registerTraitSerializer({
      id: 'position',
      trait: Position,
      read: () => undefined,
      write: () => { /* noop */ },
    })
    expect(() => registerTraitSerializer({
      id: 'position',
      trait: Health,
      read: () => undefined,
      write: () => { /* noop */ },
    })).toThrow(/duplicate/i)
  })

  it('round-trips a value-trait: read produces a JSON-clean copy, write restores it', () => {
    registerTraitSerializer({
      id: 'position',
      trait: Position,
      read: (e) => ({ ...e.get(Position)! }),
      write: (e, v) => e.set(Position, v as { x: number; y: number }),
    })

    const w1 = createWorld()
    const e1 = w1.spawn(Position({ x: 7, y: 13 }))
    const sers = getTraitSerializers()
    const snap = sers[0].read(e1, noopCtx)
    expect(snap).toEqual({ x: 7, y: 13 })

    const w2 = createWorld()
    const e2 = w2.spawn(Position({ x: 0, y: 0 }))
    sers[0].write(e2, snap as never, restoreCtx(() => null))
    expect(e2.get(Position)).toEqual({ x: 7, y: 13 })
  })

  it('round-trips entity refs via keyOf / resolveRef', () => {
    registerTraitSerializer<{ bedKey: string | null }>({
      id: 'home',
      trait: Home,
      read: (e, ctx) => {
        const h = e.get(Home)!
        return { bedKey: ctx.keyOf(h.bed) }
      },
      write: (e, v, ctx) => {
        const bed = ctx.resolveRef(v.bedKey)
        if (e.has(Home)) e.set(Home, { bed })
        else e.add(Home({ bed }))
      },
      reset: (e) => { if (e.has(Home)) e.remove(Home) },
    })

    const w1 = createWorld()
    const bedSrc = w1.spawn(Position({ x: 0, y: 0 }))
    const player = w1.spawn(Home({ bed: bedSrc }))
    const sers = getTraitSerializers()
    const ctxA: SerializeCtx = { keyOf: (e) => (e === bedSrc ? 'bed-7' : null) }
    const snap = sers[0].read(player, ctxA)
    expect(snap).toEqual({ bedKey: 'bed-7' })

    const w2 = createWorld()
    const bedDst = w2.spawn(Position({ x: 0, y: 0 }))
    const player2 = w2.spawn()
    const ctxB = restoreCtx((k) => (k === 'bed-7' ? bedDst : null))
    sers[0].write(player2, snap as never, ctxB)
    expect(player2.get(Home)?.bed).toBe(bedDst)
  })

  it('reset() removes a runtime-added trait when the snapshot is silent', () => {
    registerTraitSerializer({
      id: 'home',
      trait: Home,
      read: () => ({ bedKey: null }),
      write: () => { /* noop */ },
      reset: (e) => { if (e.has(Home)) e.remove(Home) },
    })
    const world = createWorld()
    const e = world.spawn(Home({ bed: null }))
    expect(e.has(Home)).toBe(true)
    getTraitSerializers()[0].reset!(e)
    expect(e.has(Home)).toBe(false)
  })
})
