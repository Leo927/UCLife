import './styles.css'
import { bootProd } from './bootProd'

// Test-mode boot — under ?test=1 we branch into a separate, DEV-only
// boot path (src/test/bootTestMode.ts). The whole branch tree-shakes
// out of prod bundles because `import.meta.env.DEV` inlines to false,
// and Rollup drops the unreachable `bootTestMode` chunk too — verify
// with `grep -r bootTestMode dist/` after build.
//
// Prod boot is a synchronous static import so the prod bundle stays
// flat (no top-level-await; old browser targets supported).
if (import.meta.env.DEV) {
  const search = new URLSearchParams(window.location.search)
  if (search.get('test') === '1') {
    const m = await import('./test/bootTestMode')
    await m.default(m.parseTestBootParams(search))
  } else {
    bootProd()
  }
} else {
  bootProd()
}
