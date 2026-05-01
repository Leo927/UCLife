export type RendererId = 'vector' | 'revamp'

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
