import { useQueryFirst, useTrait } from 'koota/react'
import { IsPlayer, Money } from '../ecs/traits'
import { worldConfig } from '../config'
import { getFlightHub, getRoutesFrom, type FlightRoute } from '../data/flights'
import { useUI } from './uiStore'
import { runTransition, useTransition } from '../sim/transition'
import { useClock } from '../sim/clock'
import { migratePlayerToScene } from '../sim/scene'

const TILE = worldConfig.tilePx

function formatDuration(min: number): string {
  if (min < 60) return `${min} 分钟`
  const h = Math.floor(min / 60)
  const m = min % 60
  if (m === 0) return `${h} 小时`
  return `${h} 小时 ${m} 分钟`
}

export function FlightModal() {
  const sourceId = useUI((s) => s.flightHubId)
  const close = useUI((s) => s.closeFlight)
  const showToast = useUI((s) => s.showToast)
  const player = useQueryFirst(IsPlayer)
  const money = useTrait(player, Money)
  const inTransition = useTransition((s) => s.inProgress)

  if (!sourceId) return null
  const source = getFlightHub(sourceId)
  if (!source) return null

  const routes = getRoutesFrom(sourceId)
  const playerMoney = money?.amount ?? 0

  const fly = (route: FlightRoute) => {
    if (!player) return
    if (inTransition) return
    const dest = getFlightHub(route.to)
    if (!dest) return
    const m = player.get(Money)
    if (!m || m.amount < route.fare) {
      showToast(`金钱不足 · 需 ¥${route.fare}`)
      return
    }
    // Charge fare up-front so a mid-transition cancel still reflects the
    // commitment. Same pattern as bed claims in interaction.ts.
    player.set(Money, { amount: m.amount - route.fare })
    close()
    runTransition({
      midpoint: () => {
        useClock.getState().advance(route.durationMin)
        const arrivalPx = {
          x: dest.arrivalTile.x * TILE,
          y: dest.arrivalTile.y * TILE,
        }
        migratePlayerToScene(dest.sceneId, arrivalPx)
      },
    })
  }

  return (
    <div className="status-overlay" onClick={close}>
      <div className="status-panel" onClick={(e) => e.stopPropagation()}>
        <header className="status-header">
          <h2>售票处 · {source.nameZh}</h2>
          <button className="status-close" onClick={close} aria-label="关闭">✕</button>
        </header>
        <section className="status-section">
          <div className="status-meta">现金 · ¥{playerMoney}</div>
          {source.description && (
            <p className="map-place-desc">{source.description}</p>
          )}
        </section>
        <section className="status-section">
          {routes.length === 0 && (
            <p className="map-place-desc">该航天港暂无航班。</p>
          )}
          {routes.map((r) => {
            const dest = getFlightHub(r.to)
            if (!dest) return null
            const canAfford = playerMoney >= r.fare
            return (
              <div key={`${r.from}->${r.to}`} className="transit-terminal-row">
                <div className="transit-terminal-info">
                  <div className="transit-terminal-name">{dest.nameZh}</div>
                  <p className="transit-terminal-desc">
                    航程 {formatDuration(r.durationMin)} · 票价 ¥{r.fare}
                  </p>
                  {dest.description && (
                    <p className="transit-terminal-desc">{dest.description}</p>
                  )}
                </div>
                <button
                  className="transit-terminal-go"
                  onClick={() => fly(r)}
                  disabled={!canAfford || inTransition}
                  title={!canAfford ? `金钱不足 · 需 ¥${r.fare}` : undefined}
                >
                  {canAfford ? '购票' : '钱不够'}
                </button>
              </div>
            )
          })}
        </section>
      </div>
    </div>
  )
}
