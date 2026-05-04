// Phase 3 of the Konva → Pixi migration. Minimal Pixi v8 particle pool.
//
// Why in-house: @pixi/particle-emitter only supports Pixi v6/v7 (latest
// 5.0.10 peerDeps cap at <8.0.0). When v8 support lands, this can be
// replaced with the library's PointParticle pipeline. Until then a
// pre-allocated pool keeps the surface small and inside the perf budget.
//
// Architecture:
// - Pool of fixed size (POOL_SIZE). One Sprite per slot, all sharing a
//   single 8×8 white circle Texture rendered once at construction.
// - Free-list as a simple stack of indices. spawn() pops; slots return
//   themselves to the stack when their TTL expires.
// - Update is O(active) per frame. No allocation in the hot path.
// - Sprites live in a regular Container (Pixi v8 ParticleContainer would
//   batch tighter but doesn't support per-particle alpha updates without
//   the Particle helper class — Container with shared texture batches
//   adequately at our N).
//
// Perf budget: <2ms/frame at N=500 active particles. Update is O(N)
// integration + alpha lerp. Render is one batched draw call thanks to
// the shared texture.

import { Application, Container, Graphics, Sprite, Texture, RenderTexture } from 'pixi.js'

const POOL_SIZE = 500
const PARTICLE_RADIUS = 4

interface Particle {
  sprite: Sprite
  vx: number
  vy: number
  ttl: number
  totalTtl: number
  active: boolean
}

export const particleStats = {
  enabled: false,
  spawned: 0,
  evictedFull: 0,
  active: 0,
  totalUpdateMs: 0,
  frames: 0,
}

export function resetParticleStats(): void {
  particleStats.spawned = 0
  particleStats.evictedFull = 0
  particleStats.active = 0
  particleStats.totalUpdateMs = 0
  particleStats.frames = 0
}

export class ParticlePool {
  private pool: Particle[] = []
  private freeStack: number[] = []
  private container: Container
  private texture: Texture

  constructor(app: Application, parent: Container) {
    this.container = new Container()
    this.container.label = 'particle-pool'
    parent.addChild(this.container)

    // Bake a shared circle texture. RenderTexture is destroyed alongside
    // the pool — outlives every Sprite, all of which reference it.
    const g = new Graphics()
    g.circle(PARTICLE_RADIUS, PARTICLE_RADIUS, PARTICLE_RADIUS).fill(0xffffff)
    const rt = RenderTexture.create({ width: PARTICLE_RADIUS * 2, height: PARTICLE_RADIUS * 2 })
    app.renderer.render({ container: g, target: rt })
    g.destroy()
    this.texture = rt

    for (let i = 0; i < POOL_SIZE; i++) {
      const sprite = new Sprite(this.texture)
      sprite.anchor.set(0.5)
      sprite.visible = false
      this.container.addChild(sprite)
      this.pool.push({
        sprite,
        vx: 0, vy: 0,
        ttl: 0, totalTtl: 1,
        active: false,
      })
      this.freeStack.push(i)
    }
  }

  destroy(): void {
    this.container.destroy({ children: true })
    if (this.texture instanceof RenderTexture) this.texture.destroy(true)
  }

  /**
   * Spawn one particle. Drops silently when the pool is full — bounded by
   * POOL_SIZE, so this caps the worst-case render cost.
   */
  spawn(x: number, y: number, vx: number, vy: number, ttlSec: number, color: number, scale = 1): void {
    const idx = this.freeStack.pop()
    if (idx === undefined) {
      if (particleStats.enabled) particleStats.evictedFull++
      return
    }
    const p = this.pool[idx]
    p.sprite.x = x
    p.sprite.y = y
    p.sprite.scale.set(scale, scale)
    p.sprite.tint = color
    p.sprite.alpha = 1
    p.sprite.visible = true
    p.vx = vx
    p.vy = vy
    p.ttl = ttlSec
    p.totalTtl = ttlSec
    p.active = true
    if (particleStats.enabled) particleStats.spawned++
  }

  /**
   * Integrate active particles for dt seconds. Expired slots return to
   * the free stack.
   */
  update(dtSec: number): void {
    const PROF = particleStats.enabled
    const t0 = PROF ? performance.now() : 0
    let active = 0
    for (let i = 0; i < this.pool.length; i++) {
      const p = this.pool[i]
      if (!p.active) continue
      p.ttl -= dtSec
      if (p.ttl <= 0) {
        p.active = false
        p.sprite.visible = false
        this.freeStack.push(i)
        continue
      }
      p.sprite.x += p.vx * dtSec
      p.sprite.y += p.vy * dtSec
      p.sprite.alpha = p.ttl / p.totalTtl
      active++
    }
    if (PROF) {
      particleStats.frames++
      particleStats.totalUpdateMs += performance.now() - t0
      particleStats.active = active
    }
  }

  activeCount(): number {
    return POOL_SIZE - this.freeStack.length
  }
}

/**
 * Continuously emit a thrust trail behind a ship moving with velocity (vx, vy).
 * Spawns 0..emitPerSec*dt particles per call, jittered along the ship axis
 * and with a small lateral spread. Particles drift backward and fade.
 */
export function emitThrust(
  pool: ParticlePool,
  shipX: number, shipY: number,
  shipVx: number, shipVy: number,
  dtSec: number,
  emitPerSec: number,
  color = 0xfacc15,
): void {
  const speed = Math.hypot(shipVx, shipVy)
  if (speed < 0.5) return
  const ux = -shipVx / speed
  const uy = -shipVy / speed
  // Perpendicular for lateral spread.
  const px = -uy
  const py = ux
  // Floor-with-fractional-carry would be ideal for sub-frame emission but at
  // 30Hz update + emitPerSec on the order of 60 it's not necessary —
  // rounding once per frame produces visible-but-natural variance.
  const n = Math.min(20, Math.max(0, Math.round(emitPerSec * dtSec)))
  for (let i = 0; i < n; i++) {
    const lateralJitter = (Math.random() - 0.5) * 4
    const speedJitter = 0.5 + Math.random() * 0.5
    const ttl = 0.4 + Math.random() * 0.4
    pool.spawn(
      shipX + ux * 6 + px * lateralJitter,
      shipY + uy * 6 + py * lateralJitter,
      ux * speed * speedJitter,
      uy * speed * speedJitter,
      ttl,
      color,
      0.6 + Math.random() * 0.4,
    )
  }
}
