# Portrait module — origin and license

This module ports Free Cities pregmod's procedural SVG character portrait system
into UC Life Sim. The four `.js` files in `infrastructure/`, `dispatcher/`,
`vector/`, and `revamp/` are copied **verbatim** from
[Free Cities pregmod](https://gitgud.io/pregmodfan/fc-pregmod) under the
GPL-3.0-or-later license. The `assets/` directory contains SVG layer files
copied from the same project.

## Source mapping

| File here | Original FC path |
|---|---|
| `infrastructure/artInfrastructure.js` | `js/artInfrastructure.js` |
| `dispatcher/artJS.js` | `src/art/artJS.js` |
| `vector/VectorArtJS.js` | `src/art/vector/VectorArtJS.js` |
| `revamp/vectorRevampedArtControl.js` | `src/art/vector_revamp/vectorRevampedArtControl.js` |
| `assets/vector/*.svg` | `src/art/vector/layers/*.svg` |
| `assets/vector_revamp/*.svg` | `src/art/vector_revamp/layers/*.svg` |

## License consequence

Linking GPL-3.0 code into UC Life Sim makes the **entire combined work**
GPL-3.0 when distributed. UC Life Sim's top-level LICENSE has been updated
accordingly. If you distribute UC Life Sim, you must:

1. Ship the source code (or a written offer for it).
2. Preserve copyright notices and the GPL-3.0 license text.
3. License any derivative works under GPL-3.0-or-later.

See `../../LICENSE` for the full GPL-3.0 text.

## What's been changed vs. verbatim copies

The four `.js` files are **byte-identical** to their FC counterparts. The only
new TypeScript code in this module is:

- `bridge.ts` — sets up `globalThis.App` and `globalThis.V` shims so the FC
  files can be imported as side-effects in a non-Twine environment, and re-
  exports the populated namespace as ES modules.
- `infrastructure/cacheLoader.ts` — replaces FC's
  `App.Art.cacheArtData()` (which reads from Twine `[tags="Twine.image"]`
  passages) with an async loader that consumes the build-time JSON sprite map
  produced by `scripts/buildPortraitCache.ts`.
- `adapter/` — UC `Character` + `Appearance` traits → FC `SlaveLike` shape.
- `react/Portrait.tsx` — React wrapper that renders the FC vector portrait into a DOM `<svg>`.
- `__debug__/PortraitTester.tsx` — dev visual smoke-test page.

Underscore.js's `_.intersection` (used once at `artInfrastructure.js:192`) is
provided by the bridge as `globalThis._ = { intersection }` rather than by
adding the underscore.js dependency.

## Content guardrail

FC's renderer can produce nudity/genitalia given certain slave inputs. UC Life
Sim's `adapter/characterToSlave.ts` applies a content guardrail that clamps
explicit-content fields (genitals, nudity-triggering `clothes` values) to non-
explicit defaults unless the entity carries an explicit `ExplicitContent`
opt-in trait. **Do not remove this guardrail without changing UC's content
rating.**

## Updating from upstream

To pull a newer FC pregmod version, re-run:

```bash
cp /path/to/fc-pregmod/js/artInfrastructure.js infrastructure/
cp /path/to/fc-pregmod/src/art/artJS.js dispatcher/
cp /path/to/fc-pregmod/src/art/vector/VectorArtJS.js vector/
cp /path/to/fc-pregmod/src/art/vector_revamp/vectorRevampedArtControl.js revamp/
cp -r /path/to/fc-pregmod/src/art/vector/layers/* assets/vector/
cp -r /path/to/fc-pregmod/src/art/vector_revamp/layers/* assets/vector_revamp/
npm run build:portrait-cache
```

If FC adds new `V.*` globals or new namespace assignments, update `bridge.ts`
to surface them. Otherwise the verbatim files should keep working.
