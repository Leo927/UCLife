import { audioConfig, type UiAudioId } from '../config/audio'

const cache = new Map<string, HTMLAudioElement>()

function resolveSrc(clip: string): string {
  const base = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'
  const sep = base.endsWith('/') ? '' : '/'
  return `${base}${sep}${clip}`
}

function getElement(clip: string): HTMLAudioElement | null {
  if (typeof Audio === 'undefined') return null
  const cached = cache.get(clip)
  if (cached) return cached
  const el = new Audio(resolveSrc(clip))
  el.preload = 'auto'
  cache.set(clip, el)
  return el
}

export function playUi(id: UiAudioId): void {
  if (!audioConfig.master.enabled) return
  const spec = audioConfig.clips[id]
  if (!spec) return
  const el = getElement(spec.clip)
  if (!el) return
  el.volume = Math.max(0, Math.min(1, spec.volume * audioConfig.master.volume))
  el.currentTime = 0
  // Browsers reject .play() before any user gesture and 404s reject the
  // load. Both are expected with the dummy placeholder — swallow.
  el.play().catch(() => {})
}
