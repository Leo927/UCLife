// Dev-only debug-handle registry. Each cluster file under
// src/boot/debugHandles/ side-effect-registers the slice of __uclife__
// it owns; main.tsx side-effect-imports the manifest and assembles the
// final object once. Adding a new debug-handle entry == one line in a
// cluster file (or one new cluster file + one line in the manifest),
// with no edit to main.tsx.
//
// Why not register from inside the subsystem files (e.g. sim/scene.ts)?
// Tree-shaking. A handle co-located with the subsystem only registers
// if some other module imports the subsystem first — fragile, and the
// handle would leak into the prod bundle. Putting handles in
// src/boot/debugHandles/ behind an `import.meta.env.DEV` gate keeps the
// dev surface explicit, reviewable, and dropped in production builds.
//
// Why no phases (cf. src/save/registry.ts)? Debug handles are
// side-effect-free during assembly — they're function references and
// store handles, not stateful operations with ordering constraints.

const handles = new Map<string, unknown>()

export function registerDebugHandle(name: string, value: unknown): void {
  if (handles.has(name)) {
    throw new Error(`Duplicate __uclife__ debug handle: ${name}`)
  }
  handles.set(name, value)
}

/** Test-only: clear the registry. Production code never calls this. */
export function __resetDebugHandlesForTests(): void {
  handles.clear()
}

export function assembleUclifeHandle(): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [name, value] of handles) out[name] = value
  return out
}
