// Composes the per-NPC dialogue tree by asking each branch module
// whether it has anything to contribute. Branches return null when
// they don't apply (e.g. shopkeeperBranch returns null off-shift).

import type { DialogueCtx, DialogueNode, BranchBuilder } from './types'
import { rootGreetingFor } from './branches/smallTalk'
import { smallTalkChild, farewellChild } from './branches/smallTalk'
import { shopkeeperBranch } from './branches/shopkeeper'
import { hrBranch, factoryManagerBranch } from './branches/hr'
import { realtorBranch } from './branches/realtor'
import { sellerBranch } from './branches/seller'
import { aeBranch } from './branches/ae'
import { shipDealerBranch } from './branches/shipDealer'
import { clinicBranch } from './branches/clinic'
import { pharmacyBranch } from './branches/pharmacy'
import { secretaryBranch } from './branches/secretary'
import { recruiterBranch } from './branches/recruiter'
import { researcherBranch } from './branches/researcher'
import { hangarManagerBranch } from './branches/hangarManager'
import { jobSiteBranch } from './branches/jobSite'
import { talkHireBranch } from './branches/talkHire'

const ROLE_BRANCHES: BranchBuilder[] = [
  shopkeeperBranch,
  hrBranch,
  realtorBranch,
  sellerBranch,
  aeBranch,
  shipDealerBranch,
  clinicBranch,
  pharmacyBranch,
  secretaryBranch,
  recruiterBranch,
  researcherBranch,
  hangarManagerBranch,
  factoryManagerBranch,
  jobSiteBranch,
  talkHireBranch,
]

export function buildNpcDialogue(ctx: DialogueCtx): DialogueNode {
  const children: DialogueNode[] = []
  // Always-on small-talk and goodbye book-end the role-specific options.
  children.push(smallTalkChild(ctx))
  for (const b of ROLE_BRANCHES) {
    const node = b(ctx)
    if (node) children.push(node)
  }
  children.push(farewellChild(ctx))
  return {
    id: 'root',
    info: rootGreetingFor(ctx),
    children,
  }
}
