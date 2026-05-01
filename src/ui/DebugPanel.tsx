import { useQuery, useQueryFirst } from 'koota/react'
import { useDebug, DEBUG_AVAILABLE } from '../debug/store'
import { IsPlayer, Money, Skills, Character, Health, Knows } from '../ecs/traits'
import { useUI } from './uiStore'
import { useClock } from '../sim/clock'
import { skillsConfig, aiConfig, factionsConfig } from '../config'
import { SKILL_ORDER } from '../data/skills'
import type { SkillId } from '../data/skills'
import type { FactionId } from '../data/factions'
import { addRep } from '../systems/reputation'

export function DebugPanel() {
  const open = useDebug((s) => s.panelOpen)
  const setOpen = useDebug((s) => s.setPanel)
  const alwaysHyperspeed = useDebug((s) => s.alwaysHyperspeed)
  const freezeNeeds = useDebug((s) => s.freezeNeeds)
  const setAlways = useDebug((s) => s.setAlwaysHyperspeed)
  const setFreeze = useDebug((s) => s.setFreezeNeeds)
  const moneyGift = useDebug((s) => s.moneyGift)
  const skillLevelGift = useDebug((s) => s.skillLevelGift)
  const repGift = useDebug((s) => s.repGift)
  const setMoneyGift = useDebug((s) => s.setMoneyGift)
  const setSkillLevelGift = useDebug((s) => s.setSkillLevelGift)
  const setRepGift = useDebug((s) => s.setRepGift)
  const player = useQueryFirst(IsPlayer, Money)
  const characters = useQuery(Character, Health)

  if (!DEBUG_AVAILABLE) return null
  if (!open) return null

  const giveMoney = () => {
    if (!player) return
    const m = player.get(Money)
    if (!m) return
    player.set(Money, { amount: m.amount + moneyGift })
    useUI.getState().showToast(`+ ¥${moneyGift.toLocaleString()}`)
  }

  const giveSkills = () => {
    if (!player) return
    const s = player.get(Skills)
    if (!s) return
    const bumpXp = skillLevelGift * skillsConfig.xpPerLevel
    const next = { ...s }
    for (const id of SKILL_ORDER) {
      next[id as SkillId] = (s[id as SkillId] ?? 0) + bumpXp
    }
    player.set(Skills, next)
    useUI.getState().showToast(`所有技能 +${skillLevelGift} 级`)
  }

  // Skips civilian — it's the default sentinel and would clutter StatusPanel
  // with a +S 平民 chip the player can't act on.
  const giveReputation = () => {
    if (!player) return
    let count = 0
    for (const fid of Object.keys(factionsConfig.catalog) as FactionId[]) {
      if (fid === 'civilian') continue
      addRep(player, fid, repGift)
      count += 1
    }
    useUI.getState().showToast(`+ ${repGift} 声望 × ${count} 派系 (上限 S)`)
  }

  // Mirrors relationsSystem's bidirectional write — both A→B and B→A get the
  // same edge data so symmetric checks elsewhere stay consistent.
  const befriendAll = () => {
    if (!player) return
    const nowMs = useClock.getState().gameDate.getTime()
    const opinionMax = aiConfig.relations.opinionMax
    const familiarityMax = aiConfig.relations.familiarityMax
    let count = 0
    for (const npc of characters) {
      if (npc === player) continue
      const h = npc.get(Health)
      if (h?.dead) continue
      if (!player.has(Knows(npc))) player.add(Knows(npc))
      if (!npc.has(Knows(player))) npc.add(Knows(player))
      const edge = {
        opinion: opinionMax,
        familiarity: familiarityMax,
        lastSeenMs: nowMs,
        meetCount: Math.max(1, player.get(Knows(npc))!.meetCount),
      }
      player.set(Knows(npc), edge)
      npc.set(Knows(player), { ...edge, meetCount: Math.max(1, npc.get(Knows(player))!.meetCount) })
      count += 1
    }
    useUI.getState().showToast(`已与 ${count} 位 NPC 结为挚友`)
  }

  return (
    <div className="status-overlay" onClick={() => setOpen(false)}>
      <div className="status-panel" onClick={(e) => e.stopPropagation()}>
        <header className="status-header">
          <h2>调试模式 · DEV</h2>
          <button className="status-close" onClick={() => setOpen(false)} aria-label="关闭">✕</button>
        </header>
        <section className="status-section">
          <label className="debug-row">
            <span className="debug-row-label">永久快进</span>
            <span className="debug-row-desc">忽略需求警告，时间始终跳跃推进</span>
            <input
              className="debug-toggle"
              type="checkbox"
              checked={alwaysHyperspeed}
              onChange={(e) => setAlways(e.target.checked)}
            />
          </label>
          <label className="debug-row">
            <span className="debug-row-label">冻结需求衰减</span>
            <span className="debug-row-desc">饥饿/口渴/疲劳/清洁/健康全部停止变化</span>
            <input
              className="debug-toggle"
              type="checkbox"
              checked={freezeNeeds}
              onChange={(e) => setFreeze(e.target.checked)}
            />
          </label>
          <div className="debug-row">
            <span className="debug-row-label">发钱</span>
            <span className="debug-row-desc">立刻把玩家的钱包加 ¥{moneyGift.toLocaleString()}</span>
            <div className="debug-action-group">
              <input
                className="debug-input"
                type="number"
                step={1000}
                value={moneyGift}
                onChange={(e) => setMoneyGift(Number(e.target.value))}
                aria-label="发钱金额"
              />
              <button className="debug-action" onClick={giveMoney} disabled={!player}>发放</button>
            </div>
          </div>
          <div className="debug-row">
            <span className="debug-row-label">提升技能</span>
            <span className="debug-row-desc">给玩家所有 6 项技能各加 {skillLevelGift} 级</span>
            <div className="debug-action-group">
              <input
                className="debug-input"
                type="number"
                step={1}
                value={skillLevelGift}
                onChange={(e) => setSkillLevelGift(Number(e.target.value))}
                aria-label="提升级数"
              />
              <button className="debug-action" onClick={giveSkills} disabled={!player}>发放</button>
            </div>
          </div>
          <div className="debug-row">
            <span className="debug-row-label">提升声望</span>
            <span className="debug-row-desc">给玩家与所有派系的声望各加 {repGift}（实际上限 100，等级 S）</span>
            <div className="debug-action-group">
              <input
                className="debug-input"
                type="number"
                step={100}
                value={repGift}
                onChange={(e) => setRepGift(Number(e.target.value))}
                aria-label="提升声望"
              />
              <button className="debug-action" onClick={giveReputation} disabled={!player}>发放</button>
            </div>
          </div>
          <div className="debug-row">
            <span className="debug-row-label">结识所有 NPC</span>
            <span className="debug-row-desc">把玩家与所有在世 NPC 的好感、熟悉度都拉满 (100/100)</span>
            <button className="debug-action" onClick={befriendAll} disabled={!player}>
              全部成为挚友
            </button>
          </div>
        </section>
        <section className="status-section faded">
          <p>这些选项只在开发模式下可用，发布版本会自动隐藏。存档与玩家自动驾驶请使用 ☰ 系统菜单。</p>
        </section>
      </div>
    </div>
  )
}
