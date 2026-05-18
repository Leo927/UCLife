// Backend-agnostic portrait provider surface. The FC pregmod renderer lives
// behind this interface in `providers/fc-pregmod/`; the built-in placeholder
// lives in `providers/placeholder.ts`. Nothing in this file may import from
// `providers/fc-pregmod/` — that directory is the GPL-3.0 boundary and is
// only reached through the dynamic loader in `registry.ts`.

import type { Entity } from 'koota'

export interface PortraitProvider {
  /** Stable id used by the registry and persisted user preference. */
  readonly id: string
  /** zh-CN label shown in the settings dropdown. */
  readonly displayName: string
  /** One-time async setup (asset fetch, dynamic code import). Idempotent. */
  preload(): Promise<void>
  /** Synchronous render after preload resolves. Caller appends to container. */
  render(entity: Entity): DocumentFragment | Element
}
