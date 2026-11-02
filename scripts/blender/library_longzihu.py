"""Build the Longzihu library GLB in Blender (headless).

Reference: Henan University of Animal Husbandry and Economy, Longzihu campus library.
Run:
  blender.exe -b -P scripts/blender/library_longzihu.py
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from scene_kit import add_box, add_text, clear_scene, collection as make_collection, finish, material, ROOT  # noqa: E402

GLB = ROOT / "public" / "models" / "library-longzihu.glb"
BLEND = ROOT / "assets" / "blender" / "library-longzihu.blend"
PREVIEW = ROOT / "docs" / "implementation" / "evidence" / "stage-library-3d" / "library-blender-preview.png"

W, D, H = 36.0, 16.0, 20.0
FRONT = -D / 2


def build_library(collection):
    stone = material("stone", (0.40, 0.38, 0.34), roughness=0.82)
    stone_dark = material("stone-dark", (0.24, 0.23, 0.20), roughness=0.9)
    stone_light = material("stone-light", (0.55, 0.52, 0.46), roughness=0.75)
    glass = material("glass", (0.08, 0.22, 0.30), roughness=0.10, metallic=0.25, alpha=0.46)
    mullion = material("mullion", (0.58, 0.56, 0.50), roughness=0.55)
    dark_glass = material("dark-glass", (0.04, 0.08, 0.10), roughness=0.25, metallic=0.25)
    gold = material("gold", (0.72, 0.52, 0.16), roughness=0.28, metallic=0.75)
    accent = material("accent", (0.42, 0.12, 0.06), roughness=0.55)
    red = material("led-red", (0.65, 0.035, 0.02), roughness=0.35)
    red_bsdf = red.node_tree.nodes.get("Principled BSDF")
    red_bsdf.inputs["Emission Color"].default_value = (0.8, 0.04, 0.02, 1.0)
    red_bsdf.inputs["Emission Strength"].default_value = 3.0
    steel = material("steel", (0.14, 0.15, 0.15), roughness=0.35, metallic=0.6)
    roof = material("roof", (0.52, 0.51, 0.47), roughness=0.82)

    # Podium and two street towers.
    add_box("podium", (W + 2.0, D + 1.2, 0.8), (0, 0, 0.4), stone_dark, {"bevel": 0.08, "target": collection})
    for side in (-1, 1):
        x = side * (W / 2 - 3.4)
        add_box(f"tower-{side}", (6.8, D, H), (x, 0, H / 2 + 0.8), stone, {"bevel": 0.16, "target": collection})
        # small square window near the top
        add_box(f"tower-window-{side}", (1.3, 0.14, 1.3), (x - side * 1.6, FRONT - 0.08, H - 3.0), dark_glass, {"target": collection})
        # vertical glazed slot on the inner face
        add_box(f"tower-slot-{side}", (0.75, D * 0.72, H - 2.4), (x - side * 3.5, 0.8, H / 2 + 0.8), glass, {"target": collection})
        # horizontal joints on the tower front
        for level in range(1, 5):
            add_box(f"tower-joint-{side}-{level}", (6.8, 0.08, 0.08), (x, FRONT - 0.06, 0.8 + level * 3.9), stone_dark, {"target": collection})
        for offset in (-1.8, 1.8):
            add_box(f"tower-groove-{side}-{offset}", (0.06, 0.06, 17.0), (x + offset, FRONT - 0.04, 10.4), stone_dark, {"target": collection})
        for offset in (-3.3, 3.3):
            add_box(f"tower-corner-{side}-{offset}", (0.42, 0.42, 19.4), (x + offset, FRONT - 0.12, 10.4), stone_light, {"bevel": 0.03, "target": collection})

    for side in (-1, 1):
        x = side * (W / 2 - 3.4)
        add_box(f"tower-cap-{side}", (6.8, 0.7, 1.0), (x, FRONT - 0.12, H - 0.4), stone_light, {"bevel": 0.05, "target": collection})

    # Central low block behind the recess and the top lintel connecting the towers.
    add_box("central-back", (W - 13.6, D * 0.55, H), (0, 2.0, H / 2 + 0.8), stone, {"bevel": 0.12, "target": collection})
    # Rear volume closes the back of the building; without it the roof covers an open slot.
    add_box("rear-block", (W - 13.6, 5.4, H), (0, 5.2, H / 2 + 0.8), stone, {"bevel": 0.12, "target": collection})
    add_box("top-lintel", (W, D, 2.4), (0, 0, H - 0.4), stone, {"bevel": 0.14, "target": collection})
    # two deep returns of the recess
    for side in (-1, 1):
        add_box(f"recess-cheek-{side}", (0.8, 4.0, H - 2.4), (side * (W / 2 - 6.8), FRONT + 2.0, H / 2 + 0.8), stone_light, {"bevel": 0.06, "target": collection})

    # Recessed glass curtain wall with a regular mullion grid.
    glass_y = FRONT + 3.2
    glass_w = W - 14.8
    glass_bottom = 4.95
    glass_h = 12.65
    add_box("recess-shadow", (glass_w, 0.4, glass_h), (0, glass_y + 0.8, glass_bottom + glass_h / 2), dark_glass, {"target": collection})
    add_box("curtain-glass", (glass_w, 0.16, glass_h), (0, glass_y, glass_bottom + glass_h / 2), glass, {"target": collection})
    for column in range(0, 11):
        x = -glass_w / 2 + glass_w / 10 * column
        add_box(f"mullion-v-{column}", (0.12, 0.18, glass_h), (x, glass_y - 0.38, glass_bottom + glass_h / 2), mullion, {"target": collection})
    for row in range(0, 8):
        z = glass_bottom + glass_h / 7 * row
        add_box(f"mullion-h-{row}", (glass_w, 0.18, 0.12), (0, glass_y - 0.38, z), mullion, {"target": collection})

    # Stone frame around the curtain wall, in front of the glass.
    for side in (-1, 1):
        add_box(f"glass-jamb-{side}", (1.0, 0.8, glass_h + 1.0), (side * (glass_w / 2 + 0.45), glass_y - 1.6, glass_bottom + glass_h / 2), stone_light, {"bevel": 0.04, "target": collection})
    add_box("glass-head", (glass_w + 2.0, 0.8, 0.8), (0, glass_y - 1.6, glass_bottom + glass_h + 0.35), stone_light, {"bevel": 0.04, "target": collection})
    add_box("glass-sill", (glass_w + 1.6, 0.8, 0.45), (0, glass_y - 1.6, glass_bottom), stone_light, {"bevel": 0.03, "target": collection})

    # Second-floor south entrance: platform and broad stair.
    platform_z = 4.8
    add_box("entrance-platform", (W - 16.0, 4.6, 0.45), (0, FRONT - 2.0, platform_z), stone_light, {"bevel": 0.06, "target": collection})
    add_box("entrance-base", (W - 16.0, 3.6, platform_z - 0.4), (0, FRONT - 1.5, (platform_z - 0.4) / 2), stone_dark, {"bevel": 0.08, "target": collection})
    add_box("entrance-door", (5.8, 0.22, 3.0), (0, FRONT + 2.5, platform_z + 1.5), dark_glass, {"target": collection})
    for side in (-1, 1):
        add_box(f"door-jamb-{side}", (0.35, 0.3, 3.2), (side * 3.05, FRONT + 2.4, platform_z + 1.5), stone_light, {"bevel": 0.03, "target": collection})
    add_box("door-head", (6.5, 0.3, 0.35), (0, FRONT + 2.4, platform_z + 3.15), stone_light, {"bevel": 0.03, "target": collection})
    for offset in (-1.4, 0, 1.4):
        add_box(f"door-mullion-{offset}", (0.12, 0.12, 3.0), (offset, FRONT + 2.6, platform_z + 1.5), mullion, {"target": collection})
    add_box("lintel-slot", (W - 15.5, 0.16, 0.35), (0, FRONT - 0.25, H - 2.3), dark_glass, {"target": collection})
    for step in range(8):
        top = platform_z - 0.2 - step * 0.58
        depth = 1.25 if step in (3, 6) else 0.9
        center_y = FRONT - 4.7 - step * 0.78
        add_box(f"stair-{step}", (W - 16.0, depth, 0.58), (0, center_y, top - 0.29), stone_light, {"target": collection})
        add_box(f"stair-nose-{step}", (W - 16.0, 0.08, 0.06), (0, center_y - depth / 2 + 0.02, top - 0.02), steel, {"target": collection})
    for side in (-1, 1):
        add_box(f"stair-cheek-{side}", (0.5, 7.6, 1.1), (side * (W - 16.0) / 2, FRONT - 5.4, platform_z - 0.5), stone, {"bevel": 0.04, "target": collection})
        add_box(f"stair-accent-{side}", (0.08, 2.6, 0.55), (side * ((W - 16.0) / 2 + 0.31), FRONT - 5.5, platform_z - 0.3), accent, {"target": collection})
        add_box(f"stair-rail-{side}", (0.1, 7.9, 0.1), (side * ((W - 16.0) / 2 + 0.3), FRONT - 5.4, platform_z + 0.15), steel, {"target": collection})

    # Side stone fins on the outer faces, for the deep portico read from an angle.
    for side in (-1, 1):
        # 侧立面整排竖向石肋，背后是深色玻璃带（实景左侧的柱廊感）
        add_box(f"side-glass-{side}", (0.12, D * 0.76, 17.4), (side * (W / 2 - 0.02), 0.6, 10.3), glass, {"target": collection})
        for fin in range(10):
            offset = -D * 0.36 + (D * 0.72 / 9) * fin
            add_box(f"side-fin-{side}-{fin}", (0.32, 0.24, 19.0), (side * (W / 2 + 0.12), offset, 10.4), stone_light, {"bevel": 0.03, "target": collection})

    # Rear elevation (+Y, hidden from the south approach): bands, glazed stair core and service door.
    rear_face = D / 2 + 0.04
    add_box("rear-glass-back", (12.0, 0.16, 11.2), (0, rear_face - 0.08, 11.0), dark_glass, {"target": collection})
    add_box("rear-glass", (11.4, 0.12, 10.8), (0, rear_face, 11.0), glass, {"target": collection})
    for column in range(0, 7):
        x = -11.4 / 2 + 11.4 / 6 * column
        add_box(f"rear-mullion-v-{column}", (0.12, 0.16, 10.8), (x, rear_face + 0.1, 11.0), mullion, {"target": collection})
    for row in range(0, 5):
        z = 11.0 - 10.8 / 2 + 10.8 / 4 * row
        add_box(f"rear-mullion-h-{row}", (11.4, 0.16, 0.12), (0, rear_face + 0.1, z), mullion, {"target": collection})
    for level in range(1, 5):
        add_box(f"rear-band-{level}", (W - 14.0, 0.2, 0.18), (0, rear_face + 0.16, 0.8 + level * 4.0), stone_light, {"target": collection})
    for offset in (-8.6, -5.6, 5.6, 8.6):
        add_box(f"rear-groove-{offset}", (0.1, 0.16, 18.0), (offset, rear_face + 0.12, 10.4), stone_dark, {"target": collection})
    add_box("rear-door", (3.4, 0.18, 2.6), (0, rear_face + 0.12, 1.3), dark_glass, {"target": collection})
    add_box("rear-canopy", (5.2, 1.0, 0.22), (0, rear_face + 0.5, 3.0), stone_light, {"bevel": 0.04, "target": collection})
    for side in (-1, 1):
        add_box(f"rear-side-band-{side}", (0.18, 5.2, 0.16), (side * (W / 2 + 0.06), 5.2, 4.8), stone_light, {"target": collection})
        add_box(f"rear-side-band-high-{side}", (0.18, 5.2, 0.16), (side * (W / 2 + 0.06), 5.2, 15.6), stone_light, {"target": collection})

    # Roof parapet and equipment.
    add_box("roof", (W - 1.0, D - 1.0, 0.35), (0, 0, H + 0.9), roof, {"bevel": 0.05, "target": collection})
    add_box("roof-fascia", (W + 0.4, 0.5, 0.9), (0, FRONT - 0.1, H + 0.65), stone_light, {"bevel": 0.05, "target": collection})
    add_box("roof-unit", (5.0, 3.0, 1.0), (-8, 2.0, H + 1.5), stone_light, {"bevel": 0.08, "target": collection})
    add_box("roof-unit-2", (3.0, 2.2, 0.8), (7, -2.0, H + 1.4), stone, {"bevel": 0.06, "target": collection})

    # Deep projecting canopy and the dark louver band above the glass (signature facade detail).
    add_box("glass-canopy", (glass_w + 1.4, 3.4, 0.45), (0, FRONT + 1.6, 17.8), stone_light, {"bevel": 0.06, "target": collection})
    for index in range(10):
        add_box(f"louver-{index}", (glass_w, 1.9, 0.09), (0, FRONT + 1.1, 18.15 + index * 0.145), steel, {"target": collection})
    for side in (-1, 1):
        x = side * (W / 2 - 3.4)
        add_box(f"tower-band-{side}", (6.8, 0.4, 1.1), (x, FRONT - 0.24, 19.2), stone_light, {"bevel": 0.04, "target": collection})
        add_box(f"tower-crest-{side}", (7.0, 0.7, 0.8), (x, FRONT - 0.15, 20.55), stone_light, {"bevel": 0.04, "target": collection})
    # Red LED name over the entrance, as in the actual facade.
    add_box("led-bar", (7.0, 0.12, 0.42), (0, FRONT + 2.55, platform_z + 3.4), red, {"target": collection})
    add_text("led-sign", "河南牧业经济学院", 0.9, (0, FRONT + 2.6, platform_z + 3.35),
             {"rotation": (math.radians(90), 0, 0), "mat": red, "extrude": 0.02, "target": collection})
    # White stone balustrade posts and a sloped handrail on both stair flights.
    rail_x = (W - 16.0) / 2 - 0.12
    angle = math.atan2(0.58, 0.78)
    for side in (-1, 1):
        for step in range(8):
            y = FRONT - 4.7 - step * 0.78
            top = platform_z - 0.2 - step * 0.58
            add_box(f"rail-post-{side}-{step}", (0.24, 0.24, 1.1), (side * rail_x, y, top + 0.55), stone_light, {"bevel": 0.02, "target": collection})
        for step in range(8):
            y = FRONT - 4.7 - step * 0.78
            top = platform_z - 0.2 - step * 0.58
            add_box(f"rail-seg-{side}-{step}", (0.28, 1.0, 0.16), (side * rail_x, y, top + 1.18), stone_light, {"bevel": 0.02, "target": collection})
        for step in (0, 7):
            y = FRONT - 4.7 - step * 0.78
            add_box(f"rail-cap-{side}-{step}", (0.4, 0.4, 0.25), (side * rail_x, y, platform_z - 0.2 - step * 0.58 + 1.28), stone_light, {"bevel": 0.02, "target": collection})
    for side in (-1, 1):
        for offset in (-1.8, 1.8):
            add_box(f"slot-mullion-{side}-{offset}", (0.08, 0.12, 17.0), (side * (W / 2 - 3.4) + offset, -5.8, 10.4), mullion, {"target": collection})

    # Gold signs: university name on the top lintel, library name on the right tower.
    add_text("sign-university", "河南牧业经济学院", 1.9, (0, FRONT - 0.3, H - 0.7),
             {"rotation": (math.radians(90), 0, 0), "mat": gold, "extrude": 0.06, "target": collection})
    add_text("sign-library", "图\n书\n馆", 2.1, (W / 2 - 3.4, FRONT - 0.3, H * 0.55),
             {"rotation": (math.radians(90), 0, 0), "mat": gold, "extrude": 0.06, "target": collection})



def main():
    clear_scene()
    target = make_collection("Library")
    build_library(target)
    finish(target, GLB, BLEND, PREVIEW)


if __name__ == "__main__":
    main()
