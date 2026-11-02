"""B02 2号实验楼：参考“龙子湖生工楼（善知楼）”的灰白多翼、蓝灰四坡顶与玻璃竖塔。

The official 基建处 photo is the source for the facade rhythm (bands, tower/glass slot,
hipped blue-grey roofs, square portico). The archive still defines two display floors, so the
three masses are compressed to that height at runtime; this is a visual reference model.
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from scene_kit import add_box, add_hip_roof, add_text, clear_scene, collection as make_collection, finish, material, ROOT  # noqa: E402

GLB = ROOT / "public" / "models" / "b02-lab.glb"
BLEND = ROOT / "assets" / "blender" / "b02-lab.blend"
PREVIEW = ROOT / "docs" / "implementation" / "evidence" / "stage-library-3d" / "b02-preview.png"

W, D, H = 32.0, 18.0, 16.0
FRONT = -D / 2


def facade(target, mats, spec):
    x0, x1, height, rows, columns, y0 = spec
    width = x1 - x0
    add_box(f"mass-{x0}-{x1}", (width, D, height), ((x0 + x1) / 2, 0, y0 + height / 2), mats["stone"], {"bevel": 0.08, "target": target})
    for level in range(1, rows + 1):
        z = y0 + level * (height / rows)
        add_box(f"band-{x0}-{level}", (width + 0.4, D + 0.3, 0.18), ((x0 + x1) / 2, 0, z), mats["trim"], {"target": target})
    for row in range(rows):
        z = y0 + (row + 0.55) * (height / rows)
        win_w = (width / columns) * 0.62
        for column in range(columns):
            x = x0 + (column + 0.5) * (width / columns)
            add_box(f"win-frame-{x0}-{row}-{column}", (win_w + 0.2, 0.12, 1.35), (x, FRONT - 0.04, z), mats["trim"], {"target": target})
            add_box(f"win-{x0}-{row}-{column}", (win_w, 0.16, 1.15), (x, FRONT - 0.14, z), mats["glass"], {"target": target})


def curtain_tower(target, mats):
    x = -6.4
    add_box("glass-tower", (2.6, 7.2, H - 1.0), (x, FRONT + 2.0, 0.8 + (H - 1.0) / 2), mats["curtain"], {"target": target})
    for row in range(6):
        z = 1.2 + row * 2.35
        add_box(f"curtain-h-{row}", (2.8, 7.4, 0.14), (x, FRONT + 2.0, z), mats["mullion"], {"target": target})
    for column in range(3):
        add_box(f"curtain-v-{column}", (0.14, 7.4, H - 1.0), (x - 1.2 + column * 1.2, FRONT + 2.0, 0.8 + (H - 1.0) / 2), mats["mullion"], {"target": target})


def portico(target, mats):
    add_box("portico-back", (8.2, 1.4, 10.5), (-3.4, FRONT + 0.3, 6.1), mats["stone_dark"], {"bevel": 0.05, "target": target})
    add_box("portico-glass", (5.8, 0.16, 8.0), (-3.4, FRONT - 0.5, 5.4), mats["curtain"], {"target": target})
    for index in range(4):
        x = -6.7 + index * 2.2
        add_box(f"portico-column-{index}", (0.7, 0.9, 9.6), (x, FRONT - 1.0, 5.7), mats["trim"], {"bevel": 0.04, "target": target})
    add_box("portico-lintel", (9.2, 1.4, 0.6), (-3.4, FRONT - 0.9, 10.6), mats["trim"], {"bevel": 0.05, "target": target})
    for step in range(4):
        add_box(f"portico-step-{step}", (10.4, 0.95, 0.32), (-3.4, FRONT - 2.0 - step * 0.8, 0.32 - step * 0.24), mats["stone"], {"target": target})
    add_text("sign", "实验楼", 1.35, (5.0, FRONT - 0.4, 13.2), {"rotation": (math.radians(90), 0, 0), "mat": mats["gold"], "extrude": 0.05, "target": target})


def side_windows(target, mats):
    for row in range(4):
        z = 2.2 + row * 3.3
        for index in range(4):
            y = -D / 2 + 3.0 + index * 3.4
            add_box(f"side-frame-l-{row}-{index}", (0.12, 1.3, 1.35), (-W / 2 - 0.04, y, z), mats["trim"], {"target": target})
            add_box(f"side-l-{row}-{index}", (0.16, 1.1, 1.2), (-W / 2 - 0.1, y, z), mats["glass"], {"target": target})
            add_box(f"side-frame-r-{row}-{index}", (0.12, 1.3, 1.35), (W / 2 + 0.04, y, z), mats["trim"], {"target": target})
            add_box(f"side-r-{row}-{index}", (0.16, 1.1, 1.2), (W / 2 + 0.1, y, z), mats["glass"], {"target": target})
    for index in range(5):
        x = -14.0 + index * 7.0
        add_box(f"rear-frame-{index}", (1.6, 0.12, 1.5), (x, D / 2 + 0.04, 4.0), mats["trim"], {"target": target})
        add_box(f"rear-window-{index}", (1.4, 0.16, 1.3), (x, D / 2 + 0.1, 4.0), mats["glass"], {"target": target})


def build(target):
    mats = {
        "stone": material("stone", (0.53, 0.54, 0.52), roughness=0.86),
        "stone_dark": material("stone-dark", (0.32, 0.33, 0.32), roughness=0.9),
        "trim": material("trim", (0.84, 0.84, 0.80), roughness=0.7),
        "glass": material("glass-dark", (0.05, 0.12, 0.17), roughness=0.2, metallic=0.2),
        "curtain": material("curtain", (0.10, 0.22, 0.29), roughness=0.14, metallic=0.2, alpha=0.58),
        "mullion": material("mullion", (0.66, 0.67, 0.64), roughness=0.5),
        "roof": material("roof-blue", (0.13, 0.20, 0.27), roughness=0.55, metallic=0.15),
        "gold": material("gold", (0.70, 0.50, 0.16), roughness=0.3, metallic=0.7),
    }
    add_box("plinth", (W + 2.0, D + 1.4, 0.8), (0, 0, 0.4), mats["stone_dark"], {"bevel": 0.08, "target": target})
    facade(target, mats, (-15.4, -7.4, H, 5, 2, 0.8))
    facade(target, mats, (0.2, 15.4, H - 2.0, 4, 5, 0.8))
    facade(target, mats, (-7.2, 0.0, 10.8, 3, 2, 0.8))
    curtain_tower(target, mats)
    portico(target, mats)
    side_windows(target, mats)

    add_hip_roof("roof-left", (9.0, D + 1.4, 3.2), (-11.4, 0, 0.8 + H + 1.4), mats["roof"], target)
    add_hip_roof("roof-right", (17.0, D + 1.4, 2.8), (7.8, 0, 0.8 + H - 2.0 + 1.2), mats["roof"], target)
    for side in (-1, 1):
        add_box(f"eave-left-{side}", (9.6, 0.5, 0.24), (-11.4, side * (D / 2 + 0.7), 0.8 + H + 0.1), mats["trim"], {"target": target})
    add_box("roof-flat", (8.0, D - 2.0, 0.3), (-3.4, 0, 0.8 + 10.8 + 0.2), mats["trim"], {"bevel": 0.02, "target": target})
    for index in range(4):
        add_box(f"roof-unit-{index}", (2.0, 1.6, 0.6), (-7.0 + index * 2.8, -2.0 + (index % 2) * 3.0, 12.1), mats["mullion"], {"bevel": 0.03, "target": target})
    add_box("front-link", (2.2, 2.0, 5.0), (0.0, FRONT + 1.2, 3.3), mats["curtain"], {"target": target})


def main():
    clear_scene()
    target = make_collection("B02-Lab")
    build(target)
    finish(target, GLB, BLEND, PREVIEW)


if __name__ == "__main__":
    main()
