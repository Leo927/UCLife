// Branching NPC dialogue model. Each NPCDialog renders exactly one
// DialogueNode at a time — its info text, its specialUI widget, and its
// children as buttons that navigate deeper into the tree. The runner
// holds a stack so 返回 pops back to the parent.

import type { ReactNode } from 'react'
import type { Entity } from 'koota'

export type DialogueNode = {
  // Stable id within the parent's children list — used for stack lookup
  // across re-renders. Builders must keep ids unique among siblings.
  id: string
  // Button text shown on the parent. Omit on the root.
  label?: string
  // Extra subtitle under the button label (e.g. gate hints).
  hint?: string
  // When false the button is rendered greyed out and clicking does nothing.
  enabled?: boolean
  // Lead-in text shown when this node is the active head.
  info?: ReactNode | string
  // Per-node widget rendered below info — shop list, applicant list, etc.
  specialUI?: () => ReactNode
  children?: DialogueNode[]
  // Side effect run when this node becomes the active head (or is entered
  // as a leaf with closeOnEnter).
  onEnter?: () => void
  // True for terminal action leaves: entering closes the entire NPCDialog
  // after onEnter runs.
  closeOnEnter?: boolean
}

export type DialogueRoles = {
  onShift: boolean
  isCashierOnDuty: boolean
  isHROnDuty: boolean
  isRealtorOnDuty: boolean
  isAEOnDuty: boolean
  isDoctorOnDuty: boolean
  isPharmacistOnDuty: boolean
  isSecretaryOnDuty: boolean
  isRecruiterOnDuty: boolean
  isResearcherOnDuty: boolean
  isShipDealerOnDuty: boolean
  isRecruitingManagerOnDuty: boolean
  isHangarManagerOnDuty: boolean
  isAeSupplyDealerOnDuty: boolean
  // Phase 6.2.C1 — AE light-hull sales rep at the Von Braun spaceport.
  isAEShipSalesOnDuty: boolean
  ownsPrivateFacility: boolean
  managerStation: Entity | null
}

export type DialogueCtx = {
  npc: Entity
  title: string
  employed: boolean
  roles: DialogueRoles
}

export type BranchBuilder = (ctx: DialogueCtx) => DialogueNode | null
