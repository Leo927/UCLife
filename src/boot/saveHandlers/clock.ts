// Clock state. Snapshot persists gameDate only — speed, mode, and
// forceHyperspeed are auto-paused on load by intent (let the player
// survey restored state before resuming).

import { registerSaveHandler } from '../../save/registry'
import { useClock } from '../../sim/clock'

interface ClockBlock {
  gameDate: Date
}

registerSaveHandler<ClockBlock>({
  id: 'clock',
  snapshot: () => ({ gameDate: useClock.getState().gameDate }),
  restore: (block) => {
    useClock.setState({
      gameDate: block.gameDate,
      speed: 0,
      mode: 'normal',
      forceHyperspeed: false,
    })
  },
})
