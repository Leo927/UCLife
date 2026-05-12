import json5 from 'json5'
import raw from './object-templates.json5?raw'
import type { BedTier, InteractableKind } from '../config/kinds'

export type ObjectTemplateId = string

export type LandmarkRole =
  | 'shopCounter' | 'shopApproach' | 'shopEntry' | 'shopExit'
  | 'barCounter' | 'barQueue'

/** Discriminator that tells the spawn dispatcher how to build the runtime entity. */
export type ObjectTemplateKind =
  | 'bed' | 'workstation' | 'bar_seat'
  | 'queue_point' | 'landmark' | 'partition' | 'interactable'

interface BaseTemplate {
  kind: ObjectTemplateKind
}

export interface BedTemplate extends BaseTemplate {
  kind: 'bed'
  tier: BedTier
}

export interface WorkstationTemplate extends BaseTemplate {
  kind: 'workstation'
  specId: string
  /** zh-CN label shown on the Interactable badge. Absent for some non-labeled workstations. */
  labelZh?: string
  /** When non-null, the desk gets an Interactable of this kind. Null = scenery (worker-not-workstation). */
  interactableKind: InteractableKind | null
  /** Marks the recruiter desk so spawn adds the Recruiter trait. */
  addRecruiterTrait?: true
  /** Marks the factory manager's desk so worker stations get routed to it post-spawn. */
  factoryManagerHub?: true
}

export interface BarSeatTemplate extends BaseTemplate {
  kind: 'bar_seat'
  labelZh: string
  fee: number
}

export interface QueuePointTemplate extends BaseTemplate {
  kind: 'queue_point'
  /** Landmark name registered at the placement coordinate (e.g. 'barQueue'). */
  landmarkRole: LandmarkRole
}

export interface LandmarkTemplate extends BaseTemplate {
  kind: 'landmark'
  landmarkRole: LandmarkRole
}

export interface PartitionTemplate extends BaseTemplate {
  kind: 'partition'
  orientation: 'h' | 'v'
}

export interface InteractableTemplate extends BaseTemplate {
  kind: 'interactable'
  interactableKind: InteractableKind
  labelZh: string
  fee?: number
}

export type ObjectTemplate =
  | BedTemplate
  | WorkstationTemplate
  | BarSeatTemplate
  | QueuePointTemplate
  | LandmarkTemplate
  | PartitionTemplate
  | InteractableTemplate

interface ObjectTemplatesFile {
  templates: Record<ObjectTemplateId, ObjectTemplate>
}

const parsed = json5.parse(raw) as ObjectTemplatesFile

export const objectTemplates: Readonly<Record<ObjectTemplateId, ObjectTemplate>> = parsed.templates

export function getObjectTemplate(id: ObjectTemplateId): ObjectTemplate {
  const t = objectTemplates[id]
  if (!t) throw new Error(`Unknown object template: "${id}"`)
  return t
}
