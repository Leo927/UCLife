// Asset-readiness debug handles. Exposes the `awaitAssetsReady`
// barrier (and its diagnostics) on `__uclife__` so playwright smoke
// tests can wait on the real "every async asset job has drained"
// signal instead of `page.waitForTimeout(N)`.
//
// See `src/render/assets/readiness.ts` for the contract; CLAUDE.md
// "Smoke-test reliability" for the why.

import { registerDebugHandle } from '../../debug/uclifeHandle'
import {
  awaitAssetsReady,
  pendingAssetJobs,
  snapshotPendingAssetLabels,
} from '../../render/assets/readiness'

registerDebugHandle('awaitAssetsReady', awaitAssetsReady)
registerDebugHandle('pendingAssetJobs', pendingAssetJobs)
registerDebugHandle('snapshotPendingAssetLabels', snapshotPendingAssetLabels)
