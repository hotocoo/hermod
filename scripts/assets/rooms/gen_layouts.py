"""Generates src/scene/rooms/layouts/*.json (authoring helper: the JSON is the source of truth at runtime). Run: python3 scripts/assets/rooms/gen_layouts.py"""
import json, os
OUT = os.path.join(os.path.dirname(__file__), '../../../src/scene/rooms/layouts')
def win(wall, at, sill=0.95): return {"kind": "window", "wall": wall, "at": at, "w": 1.16, "h": 1.91, "sill": sill, "asset": "window_casement"}
def L(env=0.6, shadow=1, maxl=12, fire=60, fill=0.3, fire_color="#ff8f3d", fire_decay=1.5, sky="#fff1dc", win="#fff0d6"):
    return {"kinds": {"fire": {"color": fire_color, "intensity": fire, "distance": 11, "decay": fire_decay, "flicker": 0.25}, "bulb": {"color": "#ffc98a", "intensity": 26, "distance": 9, "decay": 1.6, "cast": True},
            "flame": {"color": "#ffa855", "intensity": 2.2, "distance": 3.2, "decay": 1.9, "flicker": 0.3}},
            "window": {"color": win, "intensity": 14, "distance": 12}, "fill": {"sky": sky, "ground": "#6a5646", "intensity": fill}, "shadowLights": shadow, "maxLights": maxl, "env": env}
PRES = {"tags": ["seat"], "traces": ["metal_jug", "wooden_bowl_01", "binder_notebook", "brass_goblets", "carved_wooden_plate", "clipboard"], "figures": ["figure_a", "figure_b", "figure_c", "figure_d"], "clips": {"table": ["idle_read", "idle_write", "idle_sip"], "free": ["idle_sit", "idle_read", "idle_sip"]}}
BASE = {"baseboard": {"h": 0.16, "d": 0.03}, "crown": {"h": 0.14, "d": 0.12}}
def surf(host, assets, n, yaw="free", g="clutter"): return {"kind": "surface", "host": {"asset": host}, "assets": assets, "perHost": n, "yaw": yaw, "group": g}
def anchor(a, wall, g, along="auto"): return {"kind": "anchor", "asset": a, "wall": wall, "along": along, "group": g}
def place(a, at, g, rot=0, face=None, spread=0.5, **k):
    r = {"kind": "place", "asset": a, "at": at, "group": g, "spread": spread}; r.update({"face": face} if face else {"rotY": rot}); r.update(k); return r
def rug(at, g, rot=1.5708): return place("rug_woven", at, g, rot=rot, spread=0.01, under=True)
def wall(wall_, y, count, span, g, asset=None, assets=None):
    r = {"kind": "wallrow", "wall": wall_, "y": y, "count": count, "span": span, "group": g}; r.update({"asset": asset} if asset else {"assets": assets}); return r
def ceil(a, at): return {"kind": "ceiling", "asset": a, "at": at, "group": "lights"}
def scatter(assets, n, region, g="floor", **k): r = {"kind": "scatter", "assets": assets, "count": n, "region": region, "group": g}; r.update(k); return r
SHELF_STUFF = ["book_row_a", "book_row_b", "book_encyclopedia_set_01", "antique_ceramic_vase_01", "brass_vase_01", "mantel_clock_01", "candle_stub", "potted_plant_04", "ceramic_pot", "wicker_basket_01", "ceramic_vase_03"]
TABLE_STUFF = ["tea_set_01", "brass_goblets", "wooden_bowl_01", "binder_notebook", "wine_bottles_01", "ceramic_vase_01", "vintage_oil_lamp", "candle_taper_mid", "candle_taper_tall", "metal_jug", "carved_wooden_plate", "brass_diya_lantern"]
def room(id_, section, name, cam, shell, rules, content, **lk):
    d = {"id": id_, "section": section, "name": name, "cam": cam, "shell": shell, "rules": rules, "presence": PRES, "content": content, "lights": L(**lk)}
    json.dump(d, open(os.path.join(OUT, id_ + '.json'), 'w'), indent=1)
NB = {"asset": "notice_board", "slot": "content", "feed": "notes", "px": 2048}
FR = [{"asset": "hanging_picture_frame_01", "slot": "hanging_picture_frame_01_artwork", "feed": "frames", "px": 1024}, {"asset": "hanging_picture_frame_02", "slot": "hanging_picture_frame_02_artwork", "feed": "frames", "px": 1024}, {"asset": "hanging_picture_frame_03", "slot": "hanging_picture_frame_03_artwork", "feed": "frames", "px": 1024}]
FANCY = [{"asset": "fancy_picture_frame_01", "slot": "fancy_picture_frame_01_canvas", "feed": "frames", "px": 2048}, {"asset": "fancy_picture_frame_02", "slot": "fancy_picture_frame_02_canvas", "feed": "frames", "px": 2048}]
CH = {"assets": ["dining_chair_02"], "long": 2, "short": 1, "tuck": 0.14}

room("commons", "chat", "The Commons", {"cam": [5.1, 1.9, 4.1], "look": [-1.4, 1.15, -1.4]},
 {"w": 11, "d": 9, "h": 4.4, "floor": "old_wood_floor", "wall": "plastered_wall_02", "trim": "dark_planks", "ceiling": "painted_plaster_wall", "beams": {"material": "rough_wood", "every": 2.2, "size": [0.2, 0.28], "axis": "x"},
  "wainscot": {"material": "brown_planks_03", "h": 1.05}, **BASE, "openings": [win("n", -3.5), win("n", 3.5), win("w", 3.2), win("w", -3.2)], "keepClear": [{"x": [2.6, 5.0], "z": [2.6, 4.5]}], "hdri": "abandoned_hall_01"},
 [anchor("hearth_stone", "w", "hearth", 0), rug([-3.2, 0], "nook"), place("CoffeeTable_01", [-3.0, 0], "nook", rot=1.5708, spread=0.2),
  place("ArmChair_01", [-3.0, -1.7], "nook", face=[-3.0, 0], spread=0.3), place("ArmChair_01", [-3.0, 1.7], "nook", face=[-3.0, 0], spread=0.3), place("Rockingchair_01", [-1.7, 0.1], "nook", face=[-3.6, 0], spread=0.3),
  place("log_pile", [-4.55, 1.8], "hearth", rot=1.2, spread=0.4), place("wooden_bucket_01", [-4.7, -1.9], "hearth", spread=0.4),
  rug([1.4, -1.2], "dining", rot=0), {"kind": "set", "table": "dining_table", "at": [1.4, -2.5], "rotY": 0, "group": "dining", "chairs": CH}, {"kind": "set", "table": "dining_table", "at": [1.4, 0.5], "rotY": 0, "group": "dining", "chairs": CH},
  anchor("wooden_bookshelf_worn", "e", "shelves"), anchor("wooden_bookshelf_worn", "e", "shelves"), anchor("wooden_bookshelf_worn", "s", "shelves"),
  wall("n", 1.95, 1, [0, 0], "board", asset="notice_board"), wall("n", 2.1, 2, [-0.45, 0.45], "frames", assets=["hanging_picture_frame_01", "hanging_picture_frame_02", "hanging_picture_frame_03"]),
  wall("w", 3.1, 1, [-0.12, -0.12], "mirror", asset="ornate_mirror_01"), wall("s", 2.2, 2, [-0.5, 0.2], "frames", assets=["hanging_picture_frame_02", "hanging_picture_frame_03"]),
  wall("s", 1.75, 3, [0.4, 0.95], "hooks", assets=["fishermans_hat", "life_jacket"]), place("painted_wooden_cabinet", [4.9, 0.2], "storage", rot=-1.5708),
  ceil("Chandelier_01", [[1.4, -2.5], [1.4, 0.5]]), ceil("lantern_chandelier_01", [[-3.0, 0]]),
  place("potted_plant_02", [4.6, -3.7], "plants"), place("calathea_orbifolia_01", [-4.8, 3.7], "plants"), place("fern_02", [-1.6, 3.7], "plants"), place("planter_pot_clay", [4.9, 1.6], "plants"),
  scatter(["wicker_basket_01", "wooden_crate_01"], [1, 2], {"x": [2.6, 4.6], "z": [-3.8, -2.6]}),
  surf("dining_table", TABLE_STUFF, [4, 6], g="table"), surf("CoffeeTable_01", ["book_row_b", "candle_stub", "brass_pot_01", "tea_set_01", "brass_diya_lantern"], [2, 3], g="table"),
  surf("wooden_bookshelf_worn", SHELF_STUFF, [6, 9], "aligned", "shelf")], [NB] + FR)

room("feed", "feed", "The Gallery", {"cam": [5.3, 1.8, 3.9], "look": [-2.0, 1.55, -2.4]},
 {"w": 12, "d": 9, "h": 5, "floor": "marble_tiles", "wall": "painted_plaster_wall", "trim": "lacquered_cherry_wood", "ceiling": "painted_plaster_wall", "baseboard": {"h": 0.2, "d": 0.035}, "crown": {"h": 0.18, "d": 0.14},
  "openings": [win("n", -4.2, 1.4), win("n", 4.2, 1.4), win("e", -2.5, 1.4)], "keepClear": [{"x": [2.8, 5.8], "z": [2.4, 4.3]}], "hdri": "art_studio"},
 [rug([-1.0, 0.3], "lounge", rot=0), place("sofa_02", [-1.0, 1.45], "lounge", rot=3.1416, spread=0.3), place("sofa_02", [-1.0, -1.15], "lounge", rot=0, spread=0.3), place("CoffeeTable_01", [-1.0, 0.15], "lounge", rot=0, spread=0.2),
  place("Ottoman_01", [1.2, 0.2], "lounge", rot=0.5, spread=0.6), place("ArmChair_01", [-3.6, 0.3], "lounge", face=[-1.0, 0.3], spread=0.5),
  wall("n", 2.25, 1, [0, 0], "frames", assets=["fancy_picture_frame_02"]), wall("w", 2.1, 4, [-0.75, 0.75], "frames", assets=["fancy_picture_frame_01", "fancy_picture_frame_02", "hanging_picture_frame_01", "hanging_picture_frame_02"]),
  wall("e", 2.1, 2, [0.2, 0.8], "frames", assets=["hanging_picture_frame_03", "hanging_picture_frame_02"]), wall("s", 2.2, 3, [-0.6, 0.4], "frames", assets=["hanging_picture_frame_01", "hanging_picture_frame_03", "fancy_picture_frame_01"]),
  wall("w", 3.7, 1, [0, 0], "mirror", asset="ornate_mirror_01"),
  place("side_table_tall_01", [-4.9, -3.4], "plinths"), place("side_table_tall_01", [4.8, -3.3], "plinths"), place("side_table_tall_01", [-1.0, -3.6], "plinths"), place("side_table_tall_01", [2.4, -3.6], "plinths"),
  place("gothic_statue", [4.6, 0.3], "statues", rot=-1.6), place("painted_wooden_nightstand", [-5.2, 1.4], "plinths", rot=1.5708), place("potted_plant_02", [1.4, 3.9], "plants"),
  wall("e", 1.75, 2, [-0.9, -0.5], "hooks", assets=["fishermans_hat", "life_jacket"]), scatter(["wicker_basket_01", "wooden_stool_01", "ceramic_pot", "planter_pot_clay"], [3, 5], "edge"), rug([3.8, -1.2], "gallery", rot=1.5708),
  anchor("ClassicConsole_01", "s", "console"), anchor("ClassicConsole_01", "e", "console"), place("potted_plant_02", [-5.3, 3.6], "plants"), place("calathea_orbifolia_01", [5.4, -3.9], "plants"),
  place("easel_gallery", [3.6, -1.8], "easels", face=[0.5, 2.5], spread=0.8), place("easel_gallery", [-3.9, 2.4], "easels", face=[-1.0, 0.0], spread=0.8), place("easel_gallery", [1.2, -3.2], "easels", rot=0, spread=0.6),
  rug([3.4, 2.6], "reading", rot=0), place("painted_wooden_bench", [3.4, 3.4], "reading", rot=3.1416, spread=0.4), place("potted_plant_02", [1.0, 3.8], "plants"), place("planter_pot_clay", [-5.4, 0.2], "plants"),
  rug([-3.6, -2.2], "gallery2", rot=0), place("ottoman_placeholder", [0, 0], "x") if False else place("Ottoman_01", [-3.6, -2.2], "gallery2", rot=0.3, spread=0.4),
  ceil("Chandelier_01", [[-1.0, 0.2], [3.2, -1.5], [-4.2, -1.5]]),
  surf("side_table_tall_01", ["marble_bust_01", "bronze_whale_statue", "horse_statue_01", "brass_vase_02", "ceramic_vase_03", "antique_ceramic_vase_01"], [1, 1], g="plinth-art"), surf("painted_wooden_nightstand", ["brass_diya_lantern", "book_encyclopedia_set_01", "ceramic_pot"], [2, 3], g="clutter"),
  surf("ClassicConsole_01", ["bronze_whale_statue", "horse_statue_01", "ceramic_vase_01", "brass_vase_02", "standing_picture_frame_01", "candle_taper_mid", "postcard_set_01", "ceramic_vase_03"], [3, 4], g="clutter"),
  surf("CoffeeTable_01", ["book_encyclopedia_set_01", "tea_set_01", "candle_stub", "ceramic_pot"], [2, 3], g="clutter")], FANCY + FR + [{"asset": "easel_gallery", "slot": "canvas", "feed": "frames", "px": 1024}], env=0.9, fill=0.4)

IND = ["bench_vice_01", "hand_plane_no4", "handsaw_wood", "cross_pein_hammer", "wooden_hammer_01", "clipboard", "candle_taper_mid", "wooden_bowl_01", "metal_jug", "brass_pot_01"]
room("board", "board", "The Workshop", {"cam": [5.3, 1.95, 4.0], "look": [-2.0, 1.2, -2.2]},
 {"w": 12, "d": 9, "h": 4.6, "floor": "monastery_stone_floor", "wall": "castle_brick_02_red", "trim": "rough_wood", "ceiling": "dark_planks", "beams": {"material": "dark_planks", "every": 2.0, "size": [0.24, 0.3], "axis": "x"}, **BASE,
  "openings": [win("n", -3.8), win("n", 3.8), win("w", -2.0)], "keepClear": [{"x": [2.8, 5.8], "z": [2.6, 4.3]}], "hdri": "artist_workshop"},
 [wall("n", 2.0, 1, [0, 0], "board", asset="notice_board"), anchor("standing_chalkboard_01", "e", "board"),
  place("WoodenTable_03", [-1.0, -2.0], "benches", spread=0.3), place("WoodenTable_03", [1.8, -2.0], "benches", spread=0.3), place("metal_office_desk", [-3.8, 0.4], "benches", rot=1.5708, spread=0.3),
  place("folding_wooden_stool", [-1.0, -0.9], "stools", face=[-1.0, -2.0], spread=0.3), place("folding_wooden_stool", [1.8, -0.9], "stools", face=[1.8, -2.0], spread=0.3), place("wooden_stool_01", [-2.7, 0.4], "stools", face=[-3.8, 0.4], spread=0.3),
  anchor("steel_frame_shelves_01", "w", "shelves"), anchor("steel_frame_shelves_01", "e", "shelves"), anchor("steel_frame_shelves_01", "s", "shelves"), anchor("metal_tool_chest", "s", "storage"),
  place("tool_cart", [-4.6, 2.5], "storage", rot=0.4), place("wooden_ladder", [5.2, -0.5], "floor", rot=-1.4), place("wine_barrel_01", [-5.2, -3.7], "floor"), place("wine_barrel_01", [-4.4, -3.9], "floor"),
  wall("e", 1.55, 6, [-0.7, 0.9], "toolwall", assets=["hatchet", "rusted_hacksaw", "adjustable_wrench", "handsaw_wood", "hand_plane_no4", "cross_pein_hammer"]), wall("w", 1.55, 5, [0.1, 0.9], "toolwall", assets=["hatchet", "rusted_hacksaw", "adjustable_wrench", "handsaw_wood", "wooden_hammer_01"]),
  wall("s", 1.75, 3, [0.3, 0.9], "hooks", assets=["fishermans_hat", "life_jacket"]), place("metal_toolbox", [4.9, 1.5], "storage", rot=-1.5708), place("industrial_storage_cart", [-1.6, 3.4], "storage", rot=3.14), place("ladder_sectioned_01", [-5.3, 1.0], "floor", rot=1.5708),
  place("WoodenTable_03", [-4.2, -2.3], "benches", rot=1.5708, spread=0.4), place("WoodenTable_03", [0.4, 1.2], "benches", spread=0.6), place("potted_plant_02", [5.2, -3.7], "plants"), rug([0.4, 0.8], "bench", rot=0), scatter(["wooden_crate_01", "wooden_bucket_01", "wicker_basket_01", "wooden_broom"], [3, 4], "edge"),
  ceil("hanging_industrial_lamp", [[-1.0, -2.0], [1.8, -2.0], [-3.8, 0.4]]), ceil("caged_hanging_light", [[0.4, 1.9]]),
  surf("WoodenTable_03", IND, [4, 6], g="tools"), surf("metal_office_desk", ["desk_lamp_arm_01", "binder_notebook", "clipboard", "magnifying_glass_01", "industrial_microscope", "candle_stub"], [3, 5], g="desk"),
  surf("steel_frame_shelves_01", ["wicker_basket_01", "brass_pot_01", "wooden_bowl_01", "metal_jug", "book_row_a", "book_row_b", "ceramic_pot"], [5, 8], "aligned", "shelf-clutter"), surf("industrial_storage_cart", ["clipboard", "metal_jug", "bench_vice_01", "binder_notebook"], [2, 3], g="tools"), surf("metal_toolbox", ["hatchet", "adjustable_wrench"], [1, 2], g="tools"),
  surf("tool_cart", ["hand_plane_no4", "handsaw_wood", "clipboard"], [1, 2], g="tools")],
 [NB, {"asset": "standing_chalkboard_01", "slot": "standing_chalkboard_01_board", "feed": "chalk", "px": 1024}], env=0.9)

room("skein", "skein", "The Loom", {"cam": [4.1, 1.8, 3.5], "look": [-1.2, 1.2, -1.6]},
 {"w": 9, "d": 8, "h": 4.4, "floor": "large_sandstone_blocks_01", "wall": "plastered_wall_02", "trim": "dark_planks", "ceiling": "rough_wood", "beams": {"material": "rough_wood", "every": 1.8, "size": [0.22, 0.28], "axis": "z"}, **BASE,
  "openings": [win("n", -2.2), win("n", 2.2), win("e", 1.0), win("w", 1.0)], "keepClear": [{"x": [1.4, 4.2], "z": [2.0, 3.8]}], "hdri": "abandoned_hall_01"},
 [rug([-0.3, -1.6], "loomzone", rot=0), place("loom_warp_weighted", [-0.3, -2.0], "loom", spread=0.3), place("spinning_wheel_01", [-2.9, 0.2], "craft", rot=1.2, spread=0.4),
  rug([2.6, 0.5], "rest", rot=1.5708), place("vintage_day_bed", [3.2, -1.2], "seating", rot=-1.5708, spread=0.4), place("Rockingchair_01", [-2.6, 2.3], "seating", face=[-1.0, 0.0], spread=0.5), place("wooden_stool_01", [-1.4, -0.2], "seating", face=[-0.3, -2.0], spread=0.4),
  wall("w", 2.0, 1, [-0.5, -0.5], "board", asset="notice_board"), anchor("wooden_bookshelf_worn", "s", "shelves"), anchor("wooden_bookshelf_worn", "s", "shelves"), anchor("wooden_bookshelf_worn", "e", "shelves"),
  place("fern_02", [-3.9, 3.0], "plants"), place("planter_pot_clay", [-3.9, -3.2], "plants"), place("potted_plant_02", [3.8, -3.2], "plants"),
  wall("e", 1.75, 2, [-0.8, -0.4], "hooks", assets=["fishermans_hat", "life_jacket"]),
  scatter(["wicker_basket_01", "wooden_stool_01", "wooden_bucket_01"], [3, 4], "edge"), ceil("lantern_chandelier_01", [[-0.3, -0.6], [-2.6, 1.8]]),
  surf("wooden_bookshelf_worn", SHELF_STUFF, [6, 9], "aligned", "shelf-clutter")], [NB], env=0.9, fill=0.7)

room("desk", "desk", "The Counting House", {"cam": [4.7, 1.9, 3.8], "look": [-1.8, 1.25, -2.2]},
 {"w": 11, "d": 8.6, "h": 4.4, "floor": "old_wood_floor", "wall": "painted_plaster_wall", "trim": "lacquered_cherry_wood", "ceiling": "plastered_wall_02", "wainscot": {"material": "dark_planks", "h": 1.1}, "beams": {"material": "dark_planks", "every": 2.2, "size": [0.2, 0.26], "axis": "x"}, **BASE,
  "openings": [win("n", -3.2), win("n", 3.2), win("w", 1.8)], "keepClear": [{"x": [2.4, 5.0], "z": [2.2, 4.1]}], "hdri": "abandoned_hall_01"},
 [wall("n", 2.0, 1, [0, 0], "board", asset="notice_board"), wall("e", 2.7, 1, [0, 0], "clocks", asset="wall_clock"),
  rug([-1.4, -0.4], "desks", rot=0),
  {"kind": "set", "table": "metal_office_desk", "at": [-2.8, -1.6], "rotY": 0, "group": "desks", "chairs": {"assets": ["dining_chair_02"], "long": 1, "short": 0, "tuck": 0.12}},
  {"kind": "set", "table": "metal_office_desk", "at": [0.2, -1.6], "rotY": 0, "group": "desks", "chairs": {"assets": ["dining_chair_02"], "long": 1, "short": 0, "tuck": 0.12}},
  {"kind": "set", "table": "metal_office_desk", "at": [-1.4, 1.2], "rotY": 0, "group": "desks", "chairs": {"assets": ["dining_chair_02"], "long": 1, "short": 0, "tuck": 0.12}},
  anchor("ClassicConsole_01", "e", "counter"), place("CashRegister_01", [4.5, 0.5], "counter", rot=-1.5708, spread=0.3, y=0.95), anchor("drawer_cabinet", "e", "filing"), anchor("drawer_cabinet", "w", "filing"),
  anchor("wooden_bookshelf_worn", "s", "shelves"), anchor("wooden_bookshelf_worn", "s", "shelves"), rug([-4.0, 1.6], "waiting", rot=0),
  place("sofa_02", [-4.0, 2.6], "waiting", rot=3.1416, spread=0.3), place("CoffeeTable_01", [-4.0, 1.4], "waiting", rot=0, spread=0.3), place("potted_plant_02", [4.8, -3.4], "plants"), place("planter_pot_clay", [-5.0, -3.3], "plants"),
  rug([2.1, 0.7], "ledger", rot=0), place("side_table_01", [2.1, 0.5], "ledger", rot=0.3, spread=0.2), place("Ottoman_01", [1.3, 1.2], "ledger", rot=0.6, spread=0.2), place("wooden_bucket_01", [3.0, 1.5], "floor", spread=0.5), place("wicker_basket_01", [0.4, 0.2], "floor", spread=0.5), place("potted_plant_02", [-0.3, 2.2], "plants", spread=0.5), place("wooden_crate_01", [2.9, -0.4], "floor", rot=0.4, spread=0.4),
  place("industrial_storage_cart", [4.9, -1.8], "strongroom", rot=-1.5708, spread=0.5),
  wall("s", 1.75, 2, [0.6, 0.95], "hooks", assets=["fishermans_hat", "life_jacket"]),
  ceil("hanging_industrial_lamp", [[-2.8, -1.6], [0.2, -1.6], [-1.4, 1.2]]), ceil("lantern_chandelier_01", [[-4.0, 1.6]]),
  surf("side_table_01", ["tea_set_01", "binder_notebook", "candle_stub", "ceramic_pot"], [2, 3], g="ledger"),
  surf("metal_office_desk", ["desk_lamp_arm_01", "binder_notebook", "clipboard", "magnifying_glass_01", "round_spectacles", "alarm_clock_01", "postcard_set_01", "candle_stub", "ceramic_pot"], [4, 6], g="desk"),
  surf("drawer_cabinet", ["binder_notebook", "clipboard", "book_row_b", "mantel_clock_01", "potted_plant_04"], [2, 3], "aligned", "filing"), surf("CoffeeTable_01", ["book_encyclopedia_set_01", "tea_set_01"], [1, 2], g="waiting"),
  surf("wooden_bookshelf_worn", SHELF_STUFF, [6, 9], "aligned", "shelf-clutter")], [NB], env=0.7)

room("arcade", "arcade", "The Games Hall", {"cam": [4.7, 1.9, 3.8], "look": [-1.8, 1.2, -2.2]},
 {"w": 11, "d": 8.6, "h": 4.4, "floor": "plank_flooring_02", "wall": "plastered_wall_02", "trim": "lacquered_cherry_wood", "ceiling": "dark_planks", "wainscot": {"material": "brown_planks_03", "h": 1.05}, "beams": {"material": "rough_wood", "every": 2.2, "size": [0.2, 0.28], "axis": "x"}, **BASE,
  "openings": [win("n", -3.5), win("n", 3.5), win("w", 2.0)], "keepClear": [{"x": [2.4, 5.0], "z": [2.2, 4.1]}], "hdri": "abandoned_hall_01"},
 [wall("n", 2.0, 1, [0, 0], "leaderboard", asset="notice_board"), wall("e", 1.7, 1, [-0.3, -0.3], "games", asset="dartboard"),
  {"kind": "set", "table": "round_wooden_table_01", "at": [-2.8, -1.6], "rotY": 0, "group": "tables", "chairs": {"assets": ["dining_chair_02"], "long": 0, "short": 0, "ring": 4, "tuck": 0.12}},
  {"kind": "set", "table": "round_wooden_table_01", "at": [0.0, -0.2], "rotY": 0.4, "group": "tables", "chairs": {"assets": ["dining_chair_02"], "long": 0, "short": 0, "ring": 4, "tuck": 0.12}},
  {"kind": "set", "table": "round_wooden_table_01", "at": [-3.6, 1.6], "rotY": 0.8, "group": "tables", "chairs": {"assets": ["dining_chair_02"], "long": 0, "short": 0, "ring": 3, "tuck": 0.12}},
  rug([3.2, -2.4], "lounge", rot=1.5708), place("Sofa_01", [4.6, -2.4], "lounge", rot=-1.5708, spread=0.3), place("ArmChair_01", [2.5, -3.2], "lounge", face=[3.4, -2.4], spread=0.3), place("ArmChair_01", [2.5, -1.4], "lounge", face=[3.4, -2.4], spread=0.3), place("CoffeeTable_01", [3.4, -2.4], "lounge", rot=1.5708, spread=0.2),
  rug([-1.4, 1.2], "mid", rot=0), rug([-3.0, 0.2], "side", rot=1.5708), rug([2.3, 0.9], "play", rot=0),
  place("CoffeeTable_01", [2.3, 0.9], "play", rot=0.2, spread=0.2), place("wooden_stool_01", [1.55, 0.95], "play", rot=1.0, spread=0.2), place("folding_wooden_stool", [3.05, 0.8], "play", rot=-2.0, spread=0.2),
  place("wine_barrel_01", [4.9, 0.6], "floor", spread=0.5), place("treasure_chest", [5.0, 1.0], "floor", rot=-1.5708, spread=0.5), place("wooden_crate_01", [0.2, 3.6], "floor", rot=0.5, spread=0.5), place("dartboard_stand_placeholder", [0, 0], "x") if False else place("wooden_stool_01", [-0.4, 2.8], "stools", rot=0.3, spread=0.6), place("wooden_stool_01", [1.0, 2.6], "stools", rot=1.2, spread=0.6), place("painted_wooden_bench", [-4.5, -3.7], "seating", rot=0, spread=0.5), place("potted_plant_02", [1.8, 3.7], "plants"), place("side_table_tall_01", [-5.0, 0.6], "plinths"),
  anchor("ClassicConsole_01", "s", "bar"), anchor("ClassicConsole_01", "s", "bar"), place("potted_plant_02", [-4.9, 3.5], "plants"), place("wine_barrel_01", [-5.0, -3.4], "floor"), place("planter_pot_clay", [5.0, 3.2], "plants"),
  wall("s", 1.75, 2, [0.5, 0.9], "hooks", assets=["fishermans_hat", "life_jacket"]),
  ceil("Chandelier_01", [[-2.8, -1.6], [0.0, -0.2]]), ceil("lantern_chandelier_01", [[-3.6, 1.6], [3.4, -2.4]]),
  surf("round_wooden_table_01", ["chess_set", "brass_goblets", "tea_set_01", "candle_taper_mid", "wooden_bowl_01", "book_row_b", "carved_wooden_plate", "brass_diya_lantern"], [2, 4], g="table"),
  surf("ClassicConsole_01", ["wine_bottles_01", "brass_goblets", "candle_taper_tall", "ceramic_vase_02", "tea_set_01"], [3, 4], g="bar"), surf("CoffeeTable_01", ["chess_set", "candle_stub", "book_row_b"], [1, 2], g="lounge")],
 [NB], env=0.7)

room("hearth", "hearth", "The Hearth", {"cam": [3.4, 1.7, 3.3], "look": [-1.0, 0.9, -0.8]},
 {"w": 8, "d": 7, "h": 3.6, "floor": "monastery_stone_floor", "wall": "castle_brick_02_red", "trim": "rough_wood", "ceiling": "rough_wood", "beams": {"material": "rough_wood", "every": 1.6, "size": [0.2, 0.26], "axis": "z"}, **BASE,
  "openings": [win("n", -2.0), win("n", 2.0), win("e", 0.0)], "keepClear": [{"x": [1.4, 3.6], "z": [1.8, 3.2]}], "hdri": "abandoned_hall_01"},
 [anchor("hearth_stone", "w", "fire", 0), rug([-1.0, 0], "ring", rot=1.5708), {"kind": "set", "table": "stone_fire_pit", "at": [-1.0, 0], "rotY": 0, "group": "ring", "chairs": {"assets": ["Ottoman_01", "wooden_stool_01"], "long": 0, "short": 0, "ring": 5, "tuck": -0.25}},
  place("log_pile", [-3.2, 1.9], "fire", rot=0.8, spread=0.4), place("painted_wooden_bench", [1.9, -1.9], "seating", rot=3.1416, spread=0.4), place("Sofa_01", [2.4, 0.2], "seating", rot=-1.5708, spread=0.4),
  place("scandinavian_masonry_heater", [3.0, -2.5], "fire", rot=3.1416, spread=0.3), place("CoffeeTable_01", [1.3, 0.3], "tables", rot=1.5708, spread=0.2),
  wall("e", 1.75, 2, [-0.6, 0.4], "hooks", assets=["fishermans_hat", "life_jacket"]), wall("s", 2.0, 2, [-0.4, 0.4], "frames", assets=["hanging_picture_frame_02", "hanging_picture_frame_03"]),
  scatter(["wicker_basket_01", "wooden_bucket_01", "planter_pot_clay"], [2, 3], "edge"), ceil("lantern_chandelier_01", [[-1.0, 0]]),
  surf("CoffeeTable_01", ["tea_set_01", "brass_goblets", "candle_stub", "book_row_b", "wooden_bowl_01", "brass_diya_lantern"], [3, 4], g="table")], [FR[1], FR[2]], env=0.9, fire=26, fire_color="#ffb066", fire_decay=2, sky="#e8eeff", win="#eef3ff", fill=0.4)
