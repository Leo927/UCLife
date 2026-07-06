import json5 from 'json5'
import raw from './ms.json5?raw'

interface BayOffset {
  dx: number
  dy: number
}

// W3 (ms-identity) Task 5 — wing-AI role-tag directive. One row per
// MsRoleTag (src/ecs/traits/ms.ts). See ms.json5 for the tuning rationale.
export type WingTargetPreference = 'ms' | 'ship' | 'nearest'
export interface RoleTagAiRow {
  // Player-facing zh-CN label + one-line description (retrofit-panel picker).
  labelZh: string
  descZh: string
  targetPreference: WingTargetPreference
  maintainRangeMul: number
}

interface MsConfig {
  starterMsTemplateId: string
  starterMsEntityKey: string
  starterParts: Record<string, number>
  // Phase 6.2.5.C — starter frame-mod parts inventory.
  starterFrameModParts: Record<string, number>
  bayOffsets: BayOffset[]
  terminalOffsetDx: number
  terminalOffsetDy: number
  // Phase 6.2.5.B — depot-side bay offsets (relative to a hangar building
  // center, not a ship's hangarBay room center).
  depotBayOffsets: BayOffset[]
  // W3 (ms-identity) Task 5 — per-role wing-AI directive, keyed by MsRoleTag.
  roleTagAi: Record<string, RoleTagAiRow>
}

export const msConfig = json5.parse(raw) as MsConfig
