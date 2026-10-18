# Hearth interior props (for the map agent)

The Hearth is a pavilion owned by the town/map code, so its interior is not registered as a camera-cut room. The layout is data:
`src/scene/rooms/layouts/hearth.json` (section `hearth`), solved by `src/scene/rooms/hifi/solver.ts` (pure, no three) and built with `buildRoom()` from `src/scene/rooms/hifi/room.ts` using an `AssetLibrary` (`src/scene/assets/loader.ts`). Place the returned group under the pavilion floor; its shell can be skipped by passing a layout whose `shell` matches the pavilion footprint.

Asset ids (all in `src/scene/assets/manifest.json`, CC0, pivot bottom-centre, metres):

| role | ids |
|---|---|
| fire | `hearth_stone`, `stone_fire_pit`, `scandinavian_masonry_heater`, `log_pile` |
| seating | `painted_wooden_bench`, `Sofa_01`, `Ottoman_01`, `wooden_stool_01`, `wooden_stool_02`, `Rockingchair_01` |
| tables and soft | `CoffeeTable_01`, `rug_woven` |
| light | `lantern_chandelier_01`, `brass_diya_lantern`, `candle_stub`, `candle_taper_mid`, `candle_taper_tall` |
| cups and cloth | `tea_set_01`, `brass_goblets`, `wooden_bowl_01`, `throw_pillows_01` |
| clutter | `wicker_basket_01`, `wooden_bucket_01`, `planter_pot_clay`, `book_row_b` |
| people | `figure_a`, `figure_b`, `figure_c`, `figure_d` (rigged; clips `idle_sit`, `idle_read`, `idle_sip`, `idle_warm`, `idle_stand`; use `lib.spawnFigure`) |

Emitters: the manifest `lights` of `hearth_stone` (fire), `lantern_chandelier_01` and candles (flame) become the practical lights; fire flicker is driven by the room `tick`.

## Asset check failures owned by the map agent

`npm run assets:check` (scripts/assets/check.mjs, no loosened limits) currently fails these exterior assets; please fix them in `scripts/assets/extra/*.mjs` or their Blender scripts:
- `bollard`, `gate_pier`, `wall_seg` (also `pier_post`, `retain_seg`, `stair_seg`, `torch`, `wall_post` at the time of writing): LOD0 below the 150-triangle prop band. Give them real bevelled geometry, not a bare prism.
- `bouleuterion`, `cistern` (and any other `site_*` or landmark with a lightmap UV): UV2 overlap above 1% of covered cells. Repack UV2 with margin.

## Interior runtime contract (town.ts, rooms)

- Inside a building (not the hearth plaza) the island simulation and every island-only pass are paused after `PAUSE_AFTER` (24) settled frames; the room is drawn alone through the same post pipeline. `window.__prof.paused` shows the frame counter in dev.
- Rooms start loading on door hover and on approach; `approach()` queues programs and textures with the room's own light set (`prep(..., { room: true })`). Entry is gated: all programs are linked (`compileAsync`) and one off-screen draw warms the shadow depth/distance programs before the cut, so the first visible frame compiles nothing (`[prep] enter:<id> program link wait` in the console).
- The GI probe volume is hidden while inside (`gi.setVisible`): the room lies outside it, and visible grids change every program key.
- Figures: skeletons update once per mixer step, offscreen figures are hidden and frozen, LOD1 beyond 3.5 m from the camera, upper garments carry a depth bias so seated hips do not push pants through the hem.
- Seats: a figure sits at the measured seat top of its chair (downward rays through the LOD0 mesh at the seat's local x), not at a guessed height.
- Furniture lightmaps replace the asset's UV2 ambient occlusion (`aoMap` is dropped on those pieces; sampling it with atlas coordinates had blackened sofas, desks and cabinets).

## Interiors round 2 notes
- `hearth_stone` is now a real stone fireplace: sandstone-block PBR set (CC0 Poly Haven `large_sandstone_blocks_01`) box-projected in metres on a pier / breast / mantel / hearth-slab body, soot firebox. The old chiselled-stone bake (flat olive colour atlas, per-stone normal gradients) is gone. Authored in `scripts/assets/blender/author.py`.
- Frames and easels show real public-domain paintings (Art Institute of Chicago open access, CC0): `npm run assets:art` pins 17 images by BLAKE3 in `scripts/assets/rooms/art.lock.json`, writes `public/assets/high/rooms/art/` and `src/scene/rooms/hifi/artworks.json`. Live frame text rides on a caption plaque. Hearth binds its two hanging frames the same way (`content` in the layout).
- Hearth fire is three emitters (hearth_stone, fire pit, heater): intensity 26 each, decay 2, `#ffb066`, cool `#e8eeff` fill, so brick and stone keep their own colour.
- Room models get anisotropic filtering (8x) in `applyEnv`; GLTFLoader leaves it at 1, which made the rug weave moire.
- Ultra pack in dev: `npm run assets:ultra:link` links `public/assets/ultra -> ../../dist-assets/ultra` (`--unpack` extracts the release zip first, `--unlink` removes the link). Needed for any ultra test run; the link is git-ignored.
- Unreferenced catalog entries live in `scripts/assets/prune.json` (not built, not shipped); high-tier models total is printed by `assets:build` ("budget 260").

