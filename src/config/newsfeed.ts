import json5 from 'json5'
import raw from './newsfeed.json5?raw'

export interface NewsfeedConfig {
  // Co-location radius (px) around the bar counter within which the player
  // passively catches the bar-TV headline. Generous enough to fire when the
  // player walks up to the counter, tight enough to stay "at the bar".
  barTvRangePx: number
  // How long the bar-TV chime toast stays on screen (ms).
  chimeToastDurationMs: number
  // Id (in news.json5) of the headline the 7.0.B war-day force-toast
  // broadcasts. Pinned in config so the inert hook carries no magic string.
  warDayHeadlineId: string
}

export const newsfeedConfig = json5.parse(raw) as NewsfeedConfig
