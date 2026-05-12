import json5 from 'json5'
import raw from '../data/body-parts.json5?raw'

interface BodyPartRow {
  id: string
  labelZh: string
  paired: boolean
}

interface BodyPartsFile {
  bodyParts: BodyPartRow[]
}

const parsed = json5.parse(raw) as BodyPartsFile

const seen = new Set<string>()
for (const p of parsed.bodyParts) {
  if (!p.id) throw new Error('body-parts.json5: row missing id')
  if (seen.has(p.id)) throw new Error(`body-parts.json5: duplicate id "${p.id}"`)
  seen.add(p.id)
  if (!p.labelZh) throw new Error(`body-parts.json5: "${p.id}" missing labelZh`)
}

export const BODY_PARTS: readonly string[] = parsed.bodyParts.map((p) => p.id)
const VALID = new Set(BODY_PARTS)

export type BodyPart = string

export const BODY_PART_LABEL_ZH: Readonly<Record<string, string>> =
  Object.fromEntries(parsed.bodyParts.map((p) => [p.id, p.labelZh]))

export function isBodyPart(id: string | null | undefined): id is BodyPart {
  return typeof id === 'string' && VALID.has(id)
}

export function labelForBodyPart(id: BodyPart): string {
  return BODY_PART_LABEL_ZH[id] ?? id
}
