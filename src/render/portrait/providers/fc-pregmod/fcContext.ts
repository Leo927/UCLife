// FC-internal renderer context — what gets installed on `globalThis.V`
// so the FC pregmod JS files find the toggles they expect. Private to
// `providers/fc-pregmod/`; no module outside this directory should touch it.

export interface RendererContext {
  /** FC: V.seeVectorArtHighlights — toggle for highlight/shadow CSS */
  seeVectorArtHighlights: boolean
  /** FC: V.showBodyMods — render piercings/scars/tattoos when true */
  showBodyMods: boolean
  /** FC: V.week — seed for any per-week random art */
  week: number
}

export const DEFAULT_RENDERER_CONTEXT: RendererContext = {
  seeVectorArtHighlights: false,
  showBodyMods: true,
  week: 0,
}

export type SvgCache = Map<string, Element>
