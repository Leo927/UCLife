import { useQueryFirst, useTrait } from 'koota/react'
import { IsPlayer, Health } from '../ecs/traits'
import { resetWorld } from '../ecs/spawn'
import { useClock } from '../sim/clock'
import { playUi } from '../audio/player'

export function DeathModal() {
  const player = useQueryFirst(IsPlayer, Health)
  const health = useTrait(player, Health)
  if (!health || !health.dead) return null

  const onRestart = () => {
    playUi('ui.death.restart')
    resetWorld()
    useClock.getState().reset()
  }

  return (
    <div className="death-overlay">
      <div className="death-modal">
        <h2>你已死亡</h2>
        <p>UC 0077 — 在月面之城，你倒下了。</p>
        <button onClick={onRestart}>重新开始</button>
      </div>
    </div>
  )
}
