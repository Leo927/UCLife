import json5 from 'json5'
import raw from './audio.json5?raw'

export interface AudioClipSpec {
  clip: string
  volume: number
}

export interface AudioConfig {
  master: {
    volume: number
    enabled: boolean
  }
  clips: Record<string, AudioClipSpec>
}

export const audioConfig = json5.parse(raw) as AudioConfig

export type UiAudioId = keyof typeof audioConfig.clips & string
