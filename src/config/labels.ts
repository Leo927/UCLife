import json5 from 'json5'
import raw from './labels.json5?raw'

export interface LabelsConfig {
  building: {
    fontSizePx: number
    offsetXPx: number
    offsetYPx: number
    wordWrapWidthPx: number
  }
  interactable: {
    fontSizePx: number
    offsetYPx: number
    wordWrapWidthPx: number
    staggerStepPx: number
    staggerCount: number
  }
}

export const labelsConfig = json5.parse(raw) as LabelsConfig
