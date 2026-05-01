// Bridge between FC pregmod's Twine/SugarCube global-namespace JS files
// (verbatim ports below us) and UC's ES module world. Installs `App`, `V`,
// `State`, `_` on globalThis before importing the FC files for side effects,
// then re-exports their populated namespace as ESM functions.

import type { RendererContext, SvgCache } from './types'
import { DEFAULT_RENDERER_CONTEXT } from './types'

interface FCGlobalNamespace {
  Art: {
    SvgQueue?: new (
      transformRules: Array<{ trigger: string; action: string; value: string }>,
      cache: SvgCache,
      displayClass: string,
    ) => { add(id: string): void; output(): DocumentFragment }
    cacheArtData?: () => void
    revampedVectorArtElement?: (slave: unknown, displayClass?: string) => DocumentFragment
    revampedVectorArtStyles?: (slave: unknown) => { styleClass: string; styleCSS: string }
    generateDisplayClass?: () => string
    URLIDMatcher?: RegExp
    [k: string]: unknown
  }
  Data: {
    Art: {
      Vector?: SvgCache
      VectorRevamp?: SvgCache
      OtherSVG?: SvgCache
    }
  }
}

declare global {
  // eslint-disable-next-line no-var
  var App: FCGlobalNamespace
  // eslint-disable-next-line no-var
  var V: RendererContext & Record<string, unknown>
  // eslint-disable-next-line no-var
  var State: { temporary: Record<string, unknown>; variables?: Record<string, unknown> }
  // eslint-disable-next-line no-var
  var _: { intersection: <T>(a: T[], b: T[]) => T[] }
}

let installed = false

/** Install global namespace shims. Idempotent. Must run before any FC source. */
export function installFCGlobals(initial: Partial<RendererContext> = {}): void {
  if (installed) return
  installed = true

  const app: FCGlobalNamespace = (globalThis.App as FCGlobalNamespace) ?? { Art: {}, Data: { Art: {} } }
  app.Art = app.Art ?? {}
  app.Data = app.Data ?? { Art: {} }
  app.Data.Art = app.Data.Art ?? {}
  globalThis.App = app

  globalThis.V = { ...DEFAULT_RENDERER_CONTEXT, ...initial } as typeof globalThis.V

  // Used only by App.Art.generateDisplayClass for its counter.
  globalThis.State = { temporary: {} }

  // underscore.js _.intersection — exactly one callsite at artInfrastructure.js:192
  globalThis._ = {
    intersection<T>(a: T[], b: T[]): T[] {
      const setB = new Set(b)
      const out: T[] = []
      for (const x of a) {
        if (setB.has(x) && !out.includes(x)) out.push(x)
      }
      return out
    },
  }

  // FC defines this in dispatcher/artJS.js (a SugarCube-coupled file we
  // skipped); reimplement directly since the revamp renderer calls it.
  let displayCounter = 0
  app.Art.generateDisplayClass = function generateDisplayClass(): string {
    displayCounter += 1
    return `art${displayCounter}`
  }

  // FC's statsChecker.js (where these live) has heavy V.arcology/V.menstruation
  // coupling we didn't port. UC NPCs are always non-erect, so stub flat.
  ;(globalThis as unknown as { canAchieveErection: (s: unknown) => boolean }).canAchieveErection = () => false
  ;(globalThis as unknown as { maxErectionSize: (s: unknown) => number }).maxErectionSize = () => 0
}

export function updateRendererContext(patch: Partial<RendererContext>): void {
  if (!installed) installFCGlobals(patch)
  Object.assign(globalThis.V, patch)
}

export function getRendererContext(): RendererContext {
  if (!installed) installFCGlobals()
  return {
    seeVectorArtHighlights: globalThis.V.seeVectorArtHighlights as boolean,
    showBodyMods: globalThis.V.showBodyMods as boolean,
    week: globalThis.V.week as number,
  }
}

let loaded = false

export async function ensureLoaded(): Promise<void> {
  if (loaded) return
  installFCGlobals()
  // Order matters: helpers first (revamp control references hasAnyEyes,
  // hasLeftEye, etc. inside its methods), then artInfrastructure (populates
  // App.Art.SvgQueue), then vectorRevampedArtControl (populates
  // App.Art.revampedVectorArtElement and friends).
  await Promise.all([
    import('./dispatcher/helpers/eyeChecker.js'),
    import('./dispatcher/helpers/limbChecker.js'),
    import('./dispatcher/helpers/burstChecker.js'),
    import('./dispatcher/helpers/pregChecker.js'),
    import('./dispatcher/helpers/artHelpers.js'),
  ])
  await import('./infrastructure/artInfrastructure.js')
  await import('./revamp/vectorRevampedArtControl.js')
  if (typeof globalThis.App.Art.SvgQueue !== 'function') {
    throw new Error('Portrait bridge: App.Art.SvgQueue did not load — check artInfrastructure.js import path')
  }
  if (typeof globalThis.App.Art.revampedVectorArtElement !== 'function') {
    throw new Error('Portrait bridge: App.Art.revampedVectorArtElement did not load — check vectorRevampedArtControl.js import path')
  }
  loaded = true
}

export function getApp(): FCGlobalNamespace {
  if (!loaded) {
    throw new Error('Portrait bridge: getApp() called before ensureLoaded() resolved')
  }
  return globalThis.App as FCGlobalNamespace
}
