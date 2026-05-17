// Deterministic wall-clock shim for sim state. Production callers see
// Date.now() (epoch ms). Integration tests freeze the value so captured
// timestamps stored in entity state (capturedAtMs, atMs, lastFlashAtMs)
// are reproducible across runs, enabling snapshot comparison.
//
// Use this anywhere sim code would otherwise call Date.now() or
// performance.now(). Do not use in src/render/, src/ui/, or telemetry —
// those are presentation/measurement and must track wall-clock.

let frozenMs: number | null = null

export function simNow(): number {
  return frozenMs ?? Date.now()
}

export function freezeSimNow(ms: number): void {
  frozenMs = ms
}

export function setSimNow(ms: number): void {
  frozenMs = ms
}

export function advanceSimNow(deltaMs: number): void {
  if (frozenMs === null) return
  frozenMs += deltaMs
}

export function unfreezeSimNow(): void {
  frozenMs = null
}

export function isSimNowFrozen(): boolean {
  return frozenMs !== null
}
