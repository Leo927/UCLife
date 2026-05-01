import { useEffect, useMemo, useRef, useState } from 'react'
import { Image as KonvaImage } from 'react-konva'
import type { Entity } from 'koota'
import { useTrait } from 'koota/react'
import { Appearance, Position, Action, MoveTarget } from '../../ecs/traits'
import { composeSheet } from './compose'
import { appearanceToLpc } from './appearanceToLpc'
import type { LpcAnimation, LpcDirection } from './types'
import { useAnimTick } from './animTick'

const SPRITE_SCALE = 0.75
const FRAME = 64
const SPRITE_DRAW = FRAME * SPRITE_SCALE
// LPC frame puts the head near y=12 and feet near y=56; anchor the sprite
// to its feet rather than its top-left.
const FOOT_OFFSET_Y = 56 * SPRITE_SCALE
const HALF_W = SPRITE_DRAW / 2

const DIRECTION_ROW: Record<LpcDirection, number> = { up: 0, left: 1, down: 2, right: 3 }

// From LPC ANIMATION_CONFIGS: walk skips col 0 (standing); idle bobs 0/1.
const WALK_CYCLE = [1, 2, 3, 4, 5, 6, 7, 8] as const
const IDLE_CYCLE = [0, 0, 1] as const

interface Props {
  entity: Entity
}

export function CharacterSprite({ entity }: Props): JSX.Element | null {
  const pos = useTrait(entity, Position)
  const appearance = useTrait(entity, Appearance)
  const action = useTrait(entity, Action)
  const moveTarget = useTrait(entity, MoveTarget)
  const tick = useAnimTick((s) => s.tick)

  // Track last facing so a stopped character doesn't flip back to 'down'.
  const facingRef = useRef<LpcDirection>('down')

  const isWalking = action?.kind === 'walking'
  const animation: LpcAnimation = isWalking ? 'walk' : 'idle'

  if (pos && moveTarget && isWalking) {
    const dx = moveTarget.x - pos.x
    const dy = moveTarget.y - pos.y
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      facingRef.current = Math.abs(dx) > Math.abs(dy)
        ? (dx > 0 ? 'right' : 'left')
        : (dy > 0 ? 'down' : 'up')
    }
  }

  const manifest = useMemo(
    () => (appearance ? appearanceToLpc(appearance) : null),
    [appearance],
  )

  const [sheet, setSheet] = useState<HTMLCanvasElement | null>(null)
  useEffect(() => {
    if (!manifest) return
    let cancelled = false
    composeSheet(manifest, animation)
      .then((c) => { if (!cancelled) setSheet(c) })
      .catch((e: unknown) => {
        // eslint-disable-next-line no-console
        console.warn('[sprite] compose failed:', e)
      })
    return () => { cancelled = true }
  }, [manifest, animation])

  if (!pos || !appearance || !sheet) return null

  const cycle = isWalking ? WALK_CYCLE : IDLE_CYCLE
  const col = cycle[tick % cycle.length]
  const row = DIRECTION_ROW[facingRef.current]

  return (
    <KonvaImage
      image={sheet}
      x={pos.x - HALF_W}
      y={pos.y - FOOT_OFFSET_Y}
      width={SPRITE_DRAW}
      height={SPRITE_DRAW}
      crop={{ x: col * FRAME, y: row * FRAME, width: FRAME, height: FRAME }}
      imageSmoothingEnabled={false}
      listening={false}
    />
  )
}
