---
name: pixellab-asset
description: Generate a pixel-art game asset (object, tile, character) via the PixelLab MCP server. Use when the user asks to "generate art / a sprite / a tile / a character", "make an asset", "replace this art with something generated", or otherwise wants new pixel art for a game. Picks the right PixelLab tool + parameters based on the asset's perspective (flat overhead vs RPG 3/4 vs sidescroller), keeps generation cost low (default 1 frame, multi-frame only on explicit request), and wires the result into the project's asset config.
---

# PixelLab asset generation

PixelLab MCP exposes several generation tools and three "view" modes. The tool
determines the generation pipeline (which has style biases baked in); the
view enum picks a perspective preset within that pipeline. Pick the tool
first, the view second — prompts come last and only handle subject matter,
not perspective.

## Cost discipline

Default to a single generation: `directions: 1, n_frames: 1` (or
`create_map_object` with no `n_frames`). One asset = one generation.

Escalate to a review pack only when the user explicitly asks for options
("give me a few", "let me pick"). When escalating, default to `n_frames: 4`;
use 16 only if the user wants a broad style survey.

## Size discipline — generate at the target's exact render size

**The renderer never scales art** in this project. Scaling pixel art (even
with `nearest` filter) shimmers as the camera moves, because source pixels
map to fractional screen pixels and the rounding flips frame-to-frame.

Before generating a new asset, do the **bump-then-match** workflow:

1. **Locate the target's render size** in `src/data/object-templates.json5`:

   ```json5
   'bed-flop': { kind: 'bed', ..., visual: { w: 32, h: 32, ..., assetId: 'bed-flop' } },
   ```

   `visual.w` × `visual.h` is the in-game footprint in world pixels — and
   therefore the **required PNG dimensions**.

2. **Bump to ≥ 32 px** in each dimension if smaller. PixelLab can't paint
   meaningful detail below ~24 px and the renderer rounds aggressively at
   small sizes. If you bump, preserve aspect ratio, commit the template
   change first, then move on. New assets you author from scratch should
   default to **32 × 32** unless the object's footprint demands otherwise.

3. **Generate at exactly that size**. Pass the larger of (w, h) as `size`
   for square `create_object`; for non-square targets, use `create_map_object`
   with explicit `width`/`height`. **Do not generate at 64 then expect the
   renderer to downscale to 32 — it will flicker.**

   ```
   mcp__pixellab__create_object(
     description: "...",
     view: "high top-down",
     object_view: "top-down",
     directions: 1,
     n_frames: 1,
     size: 32,   # MATCH the template's visual.w (and h, when square)
   )
   ```

4. **Verify post-download** with `file <path>` — if PixelLab normalized the
   canvas to something other than the requested size, either regenerate or
   adjust the template's `visual.{w,h}` to match the PNG. The contract is
   *PNG size === template size*, full stop.

## Tool selection

| Asset perspective                                      | Tool                            | view              | Other params                          |
| ------------------------------------------------------ | ------------------------------- | ----------------- | ------------------------------------- |
| **Strictly flat overhead** (RTS / boardgame piece)     | `create_object`                 | `high top-down`   | `directions: 1, object_view: top-down`|
| **RPG 3/4 top-down** (RPG-Maker / Stardew style)       | `create_map_object`             | `high top-down`   | width/height per source aspect        |
| **Heavily 3/4 / shallow top-down**                     | `create_map_object`             | `low top-down`    | width/height per source aspect        |
| **Side-on platformer**                                 | `create_object`                 | `side`            | `directions: 1, object_view: sidescroller` |
| **Isometric tile** (2:1 diamond grid)                  | `create_isometric_tile`         | n/a               | tile dims                             |
| **Top-down Wang tileset** (terrain grid)               | `create_topdown_tileset`        | RTS or RPG variant| —                                     |
| **Animated character with rotations**                  | `create_character`              | n/a               | —                                     |

**`view` enum maps to the game's camera, not the camera angle:**
`high top-down` = RTS / high-altitude camera → flatter;
`low top-down` = RPG / low-altitude camera → more 3/4.

`create_object` (consistent-style pipeline) produces strictly orthographic
output. `create_map_object` runs an RPG-Maker-trained pipeline that always
includes some perspective. Choose by the asset, not by the prompt.

## Prompt — write it long, write it dense

PixelLab rewards **very detailed** prompts. A two-clause "cheap bed,
rust palette" prompt produces a generic placeholder. A 100+ word prompt
that names every material, every stain, every silhouette decision
produces a recognizable game asset. Default to writing too much, not too
little — the model trims what it can't fit; it can't invent what you
didn't say.

For each new asset, cover all of:

1. **Subject identity** — what the object *is*, in two or three nouns,
   plus the in-world function (a *coin-operated flophouse single bed*,
   not just "bed").
2. **Component-by-component breakdown** — frame, mattress, pillow,
   blanket, hardware. For each: material, color, age/wear state, surface
   texture.
3. **Specific small details** — one or two grounding touches the model
   can render (a flattened pillow with a grease stain; a brass coin slot
   with an LED; a half-folded blanket at the foot).
4. **Palette** — number of colors and the dominant hues. PixelLab honors
   "8-color palette, tarnished metal greys + rust + dirty cream + brass
   accent" more reliably than "muted colors".
5. **Style** — `pixel art`, `crisp 1-px outlines`, `no anti-aliasing`,
   `no dithering` (or `careful dithering only on shadows`).
6. **Perspective reinforcement** — even though `view` + `object_view`
   set the camera, name it again in prose: `strictly orthographic
   top-down view as if seen from directly overhead, no foreshortening,
   no visible side walls`.
7. **Background** — always `transparent background`.

### Worked example — flophouse coin-bed

> Top-down pixel-art tile of a cheap coin-operated flophouse single bed.
> Tarnished steel-grey metal frame with chipped paint and visible rust
> blooms at the corner joints. Thin lumpy mattress with a faded
> mustard-yellow quilted cover, diamond-stitch pattern. Flattened
> dingy-cream pillow at the head end, slightly off-center, with a
> greasy grey stain. Coarse grey wool blanket bunched at the foot end,
> half-folded. Small brass coin-slot box mounted to one side of the
> frame, with a single red LED. Faint dark shadow puddle beneath. Limited
> 8-color palette: tarnished metal greys, rust brown, mustard yellow,
> dingy cream, brass accent. Crisp pixel art, 1-pixel black outlines, no
> anti-aliasing, no dithering. Strictly orthographic top-down view as if
> seen from a security camera directly overhead — no foreshortening, no
> visible side walls, no perspective lines. Transparent background.

That prompt is ~130 words. Aim for that ballpark, not 20.

### Quick template

```
Top-down pixel-art tile of a <subject identity>.
<Component A — material, color, wear, texture>.
<Component B — material, color, wear, texture>.
<Component C — …>.
<One or two specific small details>.
<Limited N-color palette: hue list>.
Crisp pixel art, 1-px outlines, no anti-aliasing, no dithering.
Strictly orthographic top-down view from directly overhead, no
foreshortening, no perspective. Transparent background.
```

## Recipe — single object, default cost

For a flat top-down map object (canonical case):

1. **Resolve target size** from `src/data/object-templates.json5` (see *Size
   discipline*). Bump to ≥32 if needed and commit that change before
   generating.

2. **Generate at the target size**

   ```
   mcp__pixellab__create_object(
     description: "<object> <details>, transparent background",
     view: "high top-down",
     object_view: "top-down",
     directions: 1,
     n_frames: 1,
     size: <template.visual.w>,   # exact match — never larger than the render footprint
   )
   ```

   Returns an `object_id` and queues a job (~30–90s).

3. **Poll** with `mcp__pixellab__get_object(object_id=...)` until status is
   `completed`. Use `include_preview: false` if you just need URLs.

4. **Download** the finalized PNG:

   ```
   curl --fail -L -o "<repo>/public/art/<category>/<name>.png" \
     "https://api.pixellab.ai/mcp/objects/<object_id>/download"
   ```

   Use `--fail` so curl exits non-zero on HTTP errors rather than writing the
   error body to disk.

5. **Confirm size with `file <path>`**. The PNG dimensions **must** equal the
   template's `visual.{w,h}`. If PixelLab normalized to a different canvas,
   regenerate — do not let the renderer scale. Then **inspect** with the
   Read tool (it renders the PNG inline) — perspective and subject must
   match the request.

## Wiring into UC Life Sim's asset pack

Three layers, strictly separated:

| Layer             | Lives in                              | Owns                                                                         |
| ----------------- | ------------------------------------- | ---------------------------------------------------------------------------- |
| Asset catalog     | `src/config/art.json5`                | `id → { path }` — the file, nothing else                                     |
| Object templates  | `src/data/object-templates.json5`     | every world-object kind; `visual.{w,h,fill,stroke,label?,assetId?}` inline   |
| Asset registry    | `src/render/assets/registry.ts`       | Pixi-side loading; `getArt(id) → Texture\|null`                              |

1. **Catalog row** in `src/config/art.json5`:

   ```json5
   catalog: {
     'bed-flop': { path: '/art/objects/bed-flop.png' },
   }
   ```

   Path is absolute under Vite's public root (`public/art/...`).

2. **Object-template entry** in `src/data/object-templates.json5`. The
   template carries the visual inline — `w`/`h` is the drawn footprint in
   world pixels (also the **required PNG dimensions**, per *Size discipline*):

   ```json5
   'bed-flop': { kind: 'bed', tier: 'flop',
                 visual: { w: 32, h: 32, fill: 0x262626, stroke: 0x737373,
                           label: '投币床', assetId: 'bed-flop' } },
   ```

   `assetId` is optional; entries without one render procedurally.

3. **Renderer** reads the visual off the snap (resolved from the entity's
   `TemplateRef` in the snapshot builder), then `getArt(visual.assetId)` for
   the texture. New templates need no renderer change. The renderer paints
   the sprite at its native texture size — no scaling — so the PNG must
   match `visual.{w,h}`.

## Review-pack flow (when explicitly requested)

```
mcp__pixellab__create_object(
  description: "...",
  view: "high top-down",
  object_view: "top-down",
  directions: 1,
  n_frames: 4,           # 4 default; 16 for broad style survey
  size: 64,
)
```

`n_frames` ∈ `{1, 4, 16, 64}`. After the job completes, `get_object` returns
candidate URLs; download each to a temp dir, Read them inline, present a
short summary with your pick clearly labeled, then promote with
`select_object_frames(indices=[...])` (each picked index becomes a standalone
completed object) or discard with `dismiss_review`. Download promoted objects
via `https://api.pixellab.ai/mcp/objects/<id>/download`.
