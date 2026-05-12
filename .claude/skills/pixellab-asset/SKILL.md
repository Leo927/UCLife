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

## Prompt template

Describe the subject and style only — the tool + view handle perspective.

```
<object noun phrase>, <key visual details>, <aesthetic tag>, transparent background.
```

## Recipe — single object, default cost

For a flat top-down map object (canonical case):

1. **Generate**

   ```
   mcp__pixellab__create_object(
     description: "<object> <details>, transparent background",
     view: "high top-down",
     object_view: "top-down",
     directions: 1,
     n_frames: 1,
     size: 64,             # 32–128 covers most map objects; 64 is a good default
   )
   ```

   Returns an `object_id` and queues a job (~30–90s).

2. **Poll** with `mcp__pixellab__get_object(object_id=...)` until status is
   `completed`. Use `include_preview: false` if you just need URLs.

3. **Download** the finalized PNG:

   ```
   curl --fail -L -o "<repo>/public/art/<category>/<name>.png" \
     "https://api.pixellab.ai/mcp/objects/<object_id>/download"
   ```

   Use `--fail` so curl exits non-zero on HTTP errors rather than writing the
   error body to disk.

4. **Confirm** with `file <path>` (PixelLab sometimes normalizes canvas dims;
   verify before sizing the catalog row) and **inspect** with the Read tool
   (it renders the PNG inline). The Read inline preview is the decision
   point — perspective and subject must match the request.

## Wiring into UC Life Sim's asset pack

Three layers, strictly separated:

| Layer             | Lives in                          | Owns                                            |
| ----------------- | --------------------------------- | ----------------------------------------------- |
| Asset catalog     | `src/config/art.json5`            | `id → { path }` — the file, nothing else        |
| Object definition | `src/config/<domain>.json5`       | how a game object renders, including footprint  |
| Asset registry    | `src/render/assets/registry.ts`   | Pixi-side loading; `getArt(id) → Texture\|null` |

1. **Catalog row** in `src/config/art.json5`:

   ```json5
   catalog: {
     'bed-flop': { path: '/art/objects/bed-flop.png' },
   }
   ```

   Path is absolute under Vite's public root (`public/art/...`). Don't put
   render size here — assets are reusable across game-object sizes.

2. **Object-definition entry** in the relevant domain config (e.g.
   `src/config/beds.json5` for bed tiers):

   ```json5
   tiers: {
     flop: { w: 32, h: 32, assetId: 'bed-flop' },
   }
   ```

   `w`/`h` is the drawn footprint in world pixels — the rectangle the
   renderer paints into. Pixi scales the texture to fit; match the source
   PNG's aspect or the sprite distorts. `assetId` is optional; entries
   without one render procedurally.

3. **Renderer reads both**: `<domain>Config.<...>[key]` for footprint + asset
   id, then `getArt(id)` for the texture. New entries in an existing domain
   need no renderer code change; a brand-new asset category needs one new
   config file and one new lookup in the consuming renderer.

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
