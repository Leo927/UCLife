// Phase 5.5.4 recruitment counters. Persists the applicant-counter so
// reload doesn't reuse keys from prior applicants (mirrors population's
// immigrantCounter pattern).

import { registerSaveHandler } from '../../save/registry'
import {
  getRecruitmentState,
  setRecruitmentState,
  resetRecruitmentState,
} from '../../systems/recruitment'

type RecruitmentBlock = ReturnType<typeof getRecruitmentState>

registerSaveHandler<RecruitmentBlock>({
  id: 'recruitment',
  snapshot: () => getRecruitmentState(),
  restore: (block) => setRecruitmentState(block),
  reset: () => resetRecruitmentState(),
})
