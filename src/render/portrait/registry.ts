// Portrait provider registry. Providers self-register from their own
// modules. The placeholder provider is statically imported (small,
// asset-free, no GPL); fc-pregmod is dynamically imported the first
// time a caller asks for it, keeping the FC chunk out of the main bundle.

import type { PortraitProvider } from './types'
import { placeholderProvider } from './providers/placeholder'
import { usePortraitPrefs } from './prefs'
import { isSkipAssets } from '../../test/state'

const PLACEHOLDER_ID = 'placeholder'
const FC_PREGMOD_ID = 'fc-pregmod'

interface LazyProviderEntry {
  /** Settings-dropdown label, shown before the provider chunk is loaded. */
  displayName: string
  /** Dynamic-import + registerProvider; idempotent on success. */
  load: () => Promise<void>
}

const providers = new Map<string, PortraitProvider>()
providers.set(placeholderProvider.id, placeholderProvider)

// One dynamic-import per lazy provider. Vite splits each into its own chunk;
// fc-pregmod's chunk pulls the verbatim FC JS files transitively, so the
// whole GPL-licensed subtree stays out of the main bundle. Each loader is
// responsible for registering its provider after the import resolves.
const lazyEntries: Record<string, LazyProviderEntry> = {
  [FC_PREGMOD_ID]: {
    displayName: 'FC 矢量立绘',
    load: async () => {
      const mod = await import('./providers/fc-pregmod')
      registerProvider(mod.fcPregmodProvider)
    },
  },
}

export function registerProvider(p: PortraitProvider): void {
  if (providers.has(p.id) && providers.get(p.id) !== p) {
    throw new Error(`Duplicate portrait provider registration: ${p.id}`)
  }
  providers.set(p.id, p)
}

/** Force-load a provider by id, dynamic-importing its module if needed. */
export async function loadProvider(id: string): Promise<PortraitProvider> {
  if (!providers.has(id) && lazyEntries[id]) {
    await lazyEntries[id].load()
  }
  const p = providers.get(id)
  if (!p) throw new Error(`Unknown portrait provider: ${id}`)
  return p
}

/**
 * Resolve the provider for the current session. Test mode (where
 * `isSkipAssets()` is true) always returns placeholder to skip the
 * 28 MB FC asset fetch; otherwise honors the user's preference.
 * Falls back to placeholder for an unknown id, but lets real load
 * failures propagate so the Portrait component can show an error.
 */
export async function resolveActivePortraitProvider(): Promise<PortraitProvider> {
  if (isSkipAssets()) return placeholderProvider
  const prefId = usePortraitPrefs.getState().portraitProvider
  if (!providers.has(prefId) && !lazyEntries[prefId]) {
    console.warn(`[portrait] unknown provider '${prefId}', falling back to ${PLACEHOLDER_ID}`)
    return placeholderProvider
  }
  return loadProvider(prefId)
}

/**
 * Settings-dropdown source: every provider id known to the registry, with
 * the display label that should be shown for it. Includes lazy providers
 * that haven't been loaded yet (their displayName comes from the lazy
 * entry). Default provider first, placeholder always last as the fallback.
 */
export function listKnownProviders(): Array<{ id: string; displayName: string }> {
  const out: Array<{ id: string; displayName: string }> = []
  const seen = new Set<string>()
  for (const [id, entry] of Object.entries(lazyEntries)) {
    if (id === PLACEHOLDER_ID) continue
    out.push({ id, displayName: providers.get(id)?.displayName ?? entry.displayName })
    seen.add(id)
  }
  for (const p of providers.values()) {
    if (p.id === PLACEHOLDER_ID || seen.has(p.id)) continue
    out.push({ id: p.id, displayName: p.displayName })
    seen.add(p.id)
  }
  out.push({ id: placeholderProvider.id, displayName: placeholderProvider.displayName })
  return out
}
