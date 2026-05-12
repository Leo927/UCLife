import { useState } from 'react'
import { useTrait, useQueryFirst, useQuery } from 'koota/react'
import type { Entity } from 'koota'
import { Character, Action, Position, MoveTarget, Vitals, Health, Money, Inventory, Job, Home, Workstation, Bed, IsPlayer, Knows, Appearance, Owner, Building } from '../ecs/traits'
import type { ActionKind, Gender } from '../ecs/traits'
import { useUI } from './uiStore'
import { actionLabel } from '../data/actions'
import { getJobSpec } from '../data/jobs'
import { DEBUG_AVAILABLE } from '../debug/store'
import { tierOf, TIER_LABEL_ZH, topRelationsFor } from '../systems/relations'
import { Portrait } from '../render/portrait/react/Portrait'
import { DialogueRunner } from './dialogue/runner'
import { buildNpcDialogue } from './dialogue/builder'
import type { DialogueRoles } from './dialogue/types'
import { playUi } from '../audio/player'

const CASHIER_SPEC_IDS = ['shop_morning_clerk', 'shop_afternoon_clerk'] as const

export function NPCDialog() {
  const target = useUI((s) => s.dialogNPC)
  const setTarget = useUI((s) => s.setDialogNPC)
  const info = useTrait(target, Character)
  const action = useTrait(target, Action)
  const job = useTrait(target, Job)
  const player = useQueryFirst(IsPlayer)
  const allStations = useQuery(Workstation)
  // Subscribe to Owner so the seller branch refreshes after a transaction.
  const allBuildings = useQuery(Building, Owner)
  const [showDebug, setShowDebug] = useState(false)

  if (!target || !info) return null

  let ownsPrivateFacility = false
  for (const b of allBuildings) {
    const o = b.get(Owner)
    if (!o) continue
    if (o.kind === 'character' && o.entity === target) {
      ownsPrivateFacility = true
      break
    }
  }

  // Reverse direction (target's opinion of player) is intentionally hidden
  // so it can carry social surprise later.
  const playerEdge = (player && player.has(Knows(target))) ? player.get(Knows(target)) : null
  const playerTier = playerEdge ? tierOf(playerEdge.opinion, playerEdge.familiarity) : 'stranger'

  const close = () => {
    playUi('ui.npc.close')
    setTarget(null)
    setShowDebug(false)
  }

  const ws = job?.workstation ?? null
  const wsTrait = ws?.get(Workstation) ?? null
  const wsSpec = wsTrait ? getJobSpec(wsTrait.specId) : null
  const title = wsSpec?.jobTitle ?? info.title
  const employed = !!wsSpec

  const onShift = action?.kind === 'working'
  const specId = wsTrait?.specId ?? ''
  const isAEOnDuty = specId === 'ae_director' && onShift
  const roles: DialogueRoles = {
    onShift,
    isRealtorOnDuty: specId === 'realtor' && onShift,
    isHROnDuty: specId === 'city_hr_clerk' && onShift,
    isAEOnDuty,
    isDoctorOnDuty: specId === 'civilian_doctor' && onShift,
    isPharmacistOnDuty: specId === 'civilian_pharmacist' && onShift,
    isCashierOnDuty: onShift && (CASHIER_SPEC_IDS as readonly string[]).includes(specId),
    isSecretaryOnDuty: specId === 'secretary' && onShift,
    isRecruiterOnDuty: specId === 'recruiter' && onShift,
    isResearcherOnDuty: specId === 'researcher' && onShift,
    isHangarManagerOnDuty: specId === 'hangar_manager' && onShift,
    isAeSupplyDealerOnDuty: specId === 'ae_supply_dealer' && onShift,
    // Phase 6.2.C1 — AE light-hull sales rep at the VB airport. Distinct
    // from `ae_director` (engineering-ladder promotion gate) and from the
    // existing `isShipDealerOnDuty` (flagship purchase at the airport
    // ticket counter via the AE director). This NPC's verb is the new
    // multi-hull buy + delivery-queue flow.
    isAEShipSalesOnDuty: specId === 'ae_ship_sales_vb' && onShift,
    // Ship purchase rides on the AE director's talk-verb until a dedicated
    // ship-dealer NPC role lands.
    isShipDealerOnDuty: isAEOnDuty,
    // A recruiting manager is any NPC whose workstation is referenced as
    // managerStation by ≥1 worker station.
    isRecruitingManagerOnDuty: !!ws && onShift && allStations.some(
      (s) => s.get(Workstation)?.managerStation === ws,
    ),
    ownsPrivateFacility,
    managerStation: ws,
  }

  const root = buildNpcDialogue({ npc: target, title, employed, roles })

  return (
    <div className="status-overlay" onClick={close}>
      <div className="status-panel" onClick={(e) => e.stopPropagation()}>
        <header className="status-header">
          <h2>{info.name} · {title}</h2>
          <button className="status-close" onClick={close} aria-label="关闭">✕</button>
        </header>
        <section className="status-section npc-dialog-body">
          <div className="npc-dialog-portrait">
            <Portrait entity={target} renderer="revamp" width={160} height={220} />
          </div>
          <div className="npc-dialog-info">
            <div className="status-meta">当前: {actionLabel(action?.kind ?? 'idle') || '空闲'}</div>
            <div className="status-meta">
              {playerEdge
                ? `${TIER_LABEL_ZH[playerTier]} · 印象 ${playerEdge.opinion >= 0 ? '+' : ''}${playerEdge.opinion.toFixed(0)}`
                : `${TIER_LABEL_ZH.stranger}`}
            </div>
          </div>
        </section>
        <DialogueRunner root={root} />
        {DEBUG_AVAILABLE && (
          <section className="status-section faded">
            <h3>DEV</h3>
            <button className="dialog-option" onClick={() => { playUi('ui.npc.toggle-debug'); setShowDebug((s) => !s) }}>
              {showDebug ? '隐藏状态' : '查看状态'}
            </button>
            {showDebug && <NPCDebugView entity={target} />}
          </section>
        )}
      </div>
    </div>
  )
}

const ACTION_KINDS: readonly ActionKind[] = ['idle', 'walking', 'eating', 'sleeping', 'washing', 'working', 'reading', 'drinking', 'reveling', 'chatting'] as const

function NumEdit({ value, step, min, max, width, onCommit }: { value: number; step?: number; min?: number; max?: number; width?: number; onCommit: (n: number) => void }) {
  return (
    <input
      type="number"
      className="dev-input"
      step={step}
      min={min}
      max={max}
      style={width ? { width } : undefined}
      value={Number.isFinite(value) ? value : 0}
      onChange={(e) => {
        const n = Number(e.target.value)
        if (Number.isFinite(n)) onCommit(n)
      }}
    />
  )
}

function TextEdit({ value, width, onCommit }: { value: string; width?: number; onCommit: (s: string) => void }) {
  return (
    <input
      type="text"
      className="dev-input"
      style={width ? { width } : undefined}
      value={value}
      onChange={(e) => onCommit(e.target.value)}
    />
  )
}

function SelectEdit<T extends string>({ value, options, onCommit }: { value: T; options: readonly T[]; onCommit: (v: T) => void }) {
  return (
    <select className="dev-input dev-select" value={value} onChange={(e) => onCommit(e.target.value as T)}>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

function NPCDebugView({ entity }: { entity: Entity }) {
  const pos = useTrait(entity, Position)
  const moveTarget = useTrait(entity, MoveTarget)
  const action = useTrait(entity, Action)
  const vitals = useTrait(entity, Vitals)
  const health = useTrait(entity, Health)
  const info = useTrait(entity, Character)
  const money = useTrait(entity, Money)
  const inventory = useTrait(entity, Inventory)
  const job = useTrait(entity, Job)
  const home = useTrait(entity, Home)
  if (!pos || !action || !vitals || !info) return null
  const ws = job?.workstation ?? null
  const wsData = ws?.get(Workstation) ?? null
  const wsSpec = wsData ? getJobSpec(wsData.specId) : null
  const wsPos = ws?.get(Position) ?? null
  const bed = home?.bed ?? null
  const bedPos = bed?.get(Position) ?? null
  const bedTier = bed?.get(Bed)?.tier ?? null

  return (
    <div className="dev-info">
      <div className="dev-row">
        <span className="dev-key">动作</span>
        <span className="dev-edit-group">
          <SelectEdit value={action.kind} options={ACTION_KINDS} onCommit={(k) => entity.set(Action, { ...action, kind: k })} />
          <NumEdit value={action.remaining} width={64} onCommit={(n) => entity.set(Action, { ...action, remaining: n })} />
          <span className="dev-sep">/</span>
          <NumEdit value={action.total} width={64} onCommit={(n) => entity.set(Action, { ...action, total: n })} />
          <span className="dev-sep">分</span>
        </span>
      </div>
      <div className="dev-row">
        <span className="dev-key">位置</span>
        <span className="dev-edit-group">
          <NumEdit value={pos.x} step={1} width={72} onCommit={(n) => entity.set(Position, { ...pos, x: n })} />
          <NumEdit value={pos.y} step={1} width={72} onCommit={(n) => entity.set(Position, { ...pos, y: n })} />
        </span>
      </div>
      <div className="dev-row">
        <span className="dev-key">目标</span>
        {moveTarget ? (
          <span className="dev-edit-group">
            <NumEdit value={moveTarget.x} step={1} width={72} onCommit={(n) => entity.set(MoveTarget, { ...moveTarget, x: n })} />
            <NumEdit value={moveTarget.y} step={1} width={72} onCommit={(n) => entity.set(MoveTarget, { ...moveTarget, y: n })} />
          </span>
        ) : <span>—（无 MoveTarget）</span>}
      </div>
      <div className="dev-row"><span className="dev-key">饥饿</span><NumEdit value={vitals.hunger} step={1} min={0} max={100} onCommit={(n) => entity.set(Vitals, { ...vitals, hunger: n })} /></div>
      <div className="dev-row"><span className="dev-key">口渴</span><NumEdit value={vitals.thirst} step={1} min={0} max={100} onCommit={(n) => entity.set(Vitals, { ...vitals, thirst: n })} /></div>
      <div className="dev-row"><span className="dev-key">疲劳</span><NumEdit value={vitals.fatigue} step={1} min={0} max={100} onCommit={(n) => entity.set(Vitals, { ...vitals, fatigue: n })} /></div>
      <div className="dev-row"><span className="dev-key">清洁</span><NumEdit value={vitals.hygiene} step={1} min={0} max={100} onCommit={(n) => entity.set(Vitals, { ...vitals, hygiene: n })} /></div>
      <div className="dev-row"><span className="dev-key">烦闷</span><NumEdit value={vitals.boredom} step={1} min={0} max={100} onCommit={(n) => entity.set(Vitals, { ...vitals, boredom: n })} /></div>
      {health && (
        <div className="dev-row">
          <span className="dev-key">健康</span>
          <span className="dev-edit-group">
            <NumEdit value={health.hp} step={1} min={0} max={100} onCommit={(n) => entity.set(Health, { ...health, hp: n })} />
            <label className="dev-checkbox">
              <input type="checkbox" checked={health.dead} onChange={(e) => entity.set(Health, { ...health, dead: e.target.checked })} />
              死亡
            </label>
          </span>
        </div>
      )}
      {money && (
        <div className="dev-row">
          <span className="dev-key">金钱</span>
          <span className="dev-edit-group">
            <span className="dev-sep">¥</span>
            <NumEdit value={money.amount} step={100} onCommit={(n) => entity.set(Money, { amount: n })} />
          </span>
        </div>
      )}
      {inventory && (
        <>
          <div className="dev-row">
            <span className="dev-key">库存</span>
            <span className="dev-edit-group">
              <span className="dev-sep">水</span>
              <NumEdit value={inventory.water} step={1} min={0} width={56} onCommit={(n) => entity.set(Inventory, { ...inventory, water: n })} />
              <span className="dev-sep">餐</span>
              <NumEdit value={inventory.meal} step={1} min={0} width={56} onCommit={(n) => entity.set(Inventory, { ...inventory, meal: n })} />
              <span className="dev-sep">套餐</span>
              <NumEdit value={inventory.premiumMeal} step={1} min={0} width={56} onCommit={(n) => entity.set(Inventory, { ...inventory, premiumMeal: n })} />
              <span className="dev-sep">书</span>
              <NumEdit value={inventory.books} step={1} min={0} width={56} onCommit={(n) => entity.set(Inventory, { ...inventory, books: n })} />
            </span>
          </div>
        </>
      )}
      <div className="dev-row"><span className="dev-key">工作</span><span>{wsSpec ? `${wsSpec.jobTitle} @(${wsPos?.x.toFixed(0)}, ${wsPos?.y.toFixed(0)}) · ${wsSpec.shiftStart}:00 – ${wsSpec.shiftEnd}:00 · ¥${wsSpec.wage}` : '无业'}</span></div>
      <div className="dev-row"><span className="dev-key">家</span><span>{bedPos ? `${bedTier} @(${bedPos.x.toFixed(0)}, ${bedPos.y.toFixed(0)})` : '无家'}</span></div>
      <NPCAppearanceBlock entity={entity} />
      <NPCRelationsBlock entity={entity} />
    </div>
  )
}

const GENDER_OPTIONS: readonly Gender[] = ['male', 'female'] as const

function NPCAppearanceBlock({ entity }: { entity: Entity }) {
  const ap = useTrait(entity, Appearance)
  if (!ap) {
    return <div className="dev-row"><span className="dev-key">外观</span><span>—（无 Appearance 数据）</span></div>
  }
  const set = <K extends keyof typeof ap>(key: K, value: (typeof ap)[K]) => entity.set(Appearance, { ...ap, [key]: value })
  return (
    <>
      <div className="dev-row">
        <span className="dev-key">外观</span>
        <span className="dev-edit-group">
          <SelectEdit value={ap.gender} options={GENDER_OPTIONS} onCommit={(g) => set('gender', g)} />
          <NumEdit value={ap.physicalAge} step={1} min={0} max={120} width={64} onCommit={(n) => set('physicalAge', n)} />
          <span className="dev-sep">岁</span>
          <TextEdit value={ap.skin} width={88} onCommit={(s) => set('skin', s)} />
        </span>
      </div>
      <div className="dev-row">
        <span className="dev-key">　身高</span>
        <span className="dev-edit-group">
          <NumEdit value={ap.height} step={1} width={64} onCommit={(n) => set('height', n)} />
          <span className="dev-sep">cm 体重</span>
          <NumEdit value={ap.weight} step={1} min={-100} max={100} width={64} onCommit={(n) => set('weight', n)} />
          <span className="dev-sep">肌肉</span>
          <NumEdit value={ap.muscles} step={1} min={-100} max={100} width={64} onCommit={(n) => set('muscles', n)} />
        </span>
      </div>
      <div className="dev-row">
        <span className="dev-key">　体型</span>
        <span className="dev-edit-group">
          <span className="dev-sep">臀宽</span>
          <NumEdit value={ap.hips} step={1} min={-2} max={3} width={56} onCommit={(n) => set('hips', n)} />
          <span className="dev-sep">臀部</span>
          <NumEdit value={ap.butt} step={1} min={0} max={10} width={56} onCommit={(n) => set('butt', n)} />
          <span className="dev-sep">腰</span>
          <NumEdit value={ap.waist} step={1} min={-100} max={100} width={64} onCommit={(n) => set('waist', n)} />
        </span>
      </div>
      <div className="dev-row">
        <span className="dev-key">　胸唇</span>
        <span className="dev-edit-group">
          <span className="dev-sep">胸围</span>
          <NumEdit value={ap.boobs} step={50} min={0} width={80} onCommit={(n) => set('boobs', n)} />
          <span className="dev-sep">cc 唇</span>
          <NumEdit value={ap.lips} step={1} min={0} max={100} width={56} onCommit={(n) => set('lips', n)} />
        </span>
      </div>
      <div className="dev-row">
        <span className="dev-key">　头发</span>
        <span className="dev-edit-group">
          <TextEdit value={ap.hStyle} width={88} onCommit={(s) => set('hStyle', s)} />
          <span className="dev-sep">长</span>
          <NumEdit value={ap.hLength} step={1} min={0} max={150} width={64} onCommit={(n) => set('hLength', n)} />
          <TextEdit value={ap.hColor} width={88} onCommit={(s) => set('hColor', s)} />
        </span>
      </div>
      <div className="dev-row">
        <span className="dev-key">　阴毛</span>
        <span className="dev-edit-group">
          <TextEdit value={ap.pubicHStyle} width={88} onCommit={(s) => set('pubicHStyle', s)} />
          <TextEdit value={ap.pubicHColor} width={88} onCommit={(s) => set('pubicHColor', s)} />
        </span>
      </div>
      <div className="dev-row">
        <span className="dev-key">　腋毛</span>
        <span className="dev-edit-group">
          <TextEdit value={ap.underArmHStyle} width={88} onCommit={(s) => set('underArmHStyle', s)} />
          <TextEdit value={ap.underArmHColor} width={88} onCommit={(s) => set('underArmHColor', s)} />
        </span>
      </div>
      <div className="dev-row">
        <span className="dev-key">　眼妆</span>
        <span className="dev-edit-group">
          <span className="dev-sep">虹膜</span>
          <TextEdit value={ap.eyeIris} width={88} onCommit={(s) => set('eyeIris', s)} />
          <span className="dev-sep">妆容</span>
          <NumEdit value={ap.makeup} step={1} min={0} max={8} width={56} onCommit={(n) => set('makeup', n)} />
        </span>
      </div>
    </>
  )
}

// Koota relations don't have a useTrait equivalent; reading once per render
// is acceptable here because the dev view is gated behind a manual toggle.
function NPCRelationsBlock({ entity }: { entity: Entity }) {
  const top = topRelationsFor(entity, 5)
  if (top.length === 0) {
    return <div className="dev-row"><span className="dev-key">人际</span><span>—</span></div>
  }
  return (
    <>
      <div className="dev-row"><span className="dev-key">人际</span><span>{top.length} 条主要关系</span></div>
      {top.map((r) => {
        const target = r.target
        if (!target) return null
        const ch = target.get(Character)
        const name = ch?.name ?? '?'
        const sign = r.data.opinion >= 0 ? '+' : ''
        return (
          <div key={target.id()} className="dev-row">
            <span className="dev-key">　{TIER_LABEL_ZH[r.tier]}</span>
            <span>{name} · 印象 {sign}{r.data.opinion.toFixed(0)} · 熟悉 {r.data.familiarity.toFixed(0)} · {r.data.meetCount} 次</span>
          </div>
        )
      })}
    </>
  )
}
