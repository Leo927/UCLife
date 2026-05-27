import json5 from 'json5'
import raw from './ms.json5?raw'

interface BayOffset {
  dx: number
  dy: number
}

interface MsConfig {
  starterMsTemplateId: string
  starterMsEntityKey: string
  starterParts: Record<string, number>
  bayOffsets: BayOffset[]
  terminalOffsetDx: number
  terminalOffsetDy: number
  // Phase 6.2.5.B — depot-side bay offsets (relative to a hangar building
  // center, not a ship's hangarBay room center).
  depotBayOffsets: BayOffset[]
}

export const msConfig = json5.parse(raw) as MsConfig
