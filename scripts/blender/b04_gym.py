"""B04 体育馆：参考校方基建处“英才体育馆”实景的低矮大跨、弧形金属屋面与深色高侧窗带。

The Longzihu archive names a gymnasium but no verified Longzihu gym elevation was published;
this model follows the university's own gym reference and the archive's single-storey volume.
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from scene_kit import add_box, add_text, clear_scene, collection as make_collection, finish, material, ROOT  # noqa: E402

GLB = ROOT / "public" / "models" / "b04-gym.glb"
BLEND = ROOT / "assets" / "blender" / "b04-gym.blend"
PREVIEW = ROOT / "docs" / "implementation" / "evidence" / "stage-library-3d" / "b04-preview.png"

W, D, H = 30.0, 20.0, 7.0
FRONT = -D / 2


def ribbon_windows(target, mats):
    for row in range(2):
        z = 2.2 + row * 2.6
        for index in range(7):
            x = -W / 2 + 2.0 + index * 3.8
            add_box(f"front-frame-{row}-{index}", (2.6, 0.14, 1.55), (x, FRONT - 0.04, z), mats["trim"], {"target": target})
            add_box(f"front-glass-{row}-{index}", (2.4, 0.16, 1.35), (x, FRONT - 0.14, z), mats["glass"], {"target": target})
        add_box(f"front-band-{row}", (W - 2.0, D + 0.4, 0.18), (0, 0, z - 1.1), mats["trim"], {"target": target})


def clerestory(target, mats):
    add_box("clerestory-glass", (W - 3.0, 0.18, 2.3), (0, FRONT - 0.02, 6.8), mats["glass_dark"], {"target": target})
    for index in range(10):
        x = -W / 2 + 2.0 + index * 2.85
        add_box(f"clerestory-mullion-{index}", (0.12, 0.24, 2.3), (x, FRONT - 0.16, 6.8), mats["trim"], {"target": target})
    add_box("clerestory-head", (W - 1.0, 0.5, 0.34), (0, FRONT - 0.1, 8.0), mats["trim"], {"bevel": 0.03, "target": target})


def entrance(target, mats):
    add_box("entry-bay", (9.2, 1.2, 6.0), (-4.0, FRONT - 0.45, 3.5), mats["stone_dark"], {"bevel": 0.05, "target": target})
    add_box("entry-glass", (6.8, 0.16, 4.4), (-4.0, FRONT - 1.1, 3.1), mats["glass_dark"], {"target": target})
    for index in range(4):
        add_box(f"entry-mullion-{index}", (0.10, 0.2, 4.4), (-7.0 + index * 2.0, FRONT - 1.2, 3.1), mats["trim"], {"target": target})
    add_box("entry-canopy", (11.0, 3.0, 0.34), (-4.0, FRONT - 1.8, 6.0), mats["trim"], {"bevel": 0.04, "target": target})
    for step in range(3):
        add_box(f"entry-step-{step}", (11.5, 0.9, 0.28), (-4.0, FRONT - 2.7 - step * 0.7, 0.28 - step * 0.2), mats["stone"], {"target": target})
    add_text("sign", "体育馆", 1.3, (-4.0, FRONT - 1.4, 7.1), {"rotation": (math.radians(90), 0, 0), "mat": mats["gold"], "extrude": 0.05, "target": target})


def curved_roof(target, mats):
    segments = 8
    for index in range(segments):
        t = (index + 0.5) / segments
        x = -W / 2 + (index + 0.5) * W / segments
        z = 8.1 + 2.1 * math.sin(math.pi * t)
        slope = 2.1 * math.pi / W * math.cos(math.pi * t)
        add_box(f"roof-seg-{index}", (W / segments + 0.24, D + 2.4, 0.34), (x, 0, z),
                mats["roof"], {"target": target, "rotation": (0, -math.atan(slope), 0)})
    for index in range(segments + 1):
        x = -W / 2 + index * W / segments
        t = index / segments
        z = 8.1 + 2.1 * math.sin(math.pi * t)
        add_box(f"roof-seam-{index}", (0.12, D + 2.3, 0.08), (x, 0, z + 0.22), mats["trim"], {"target": target})
    add_box("roof-edge-front", (W + 2.4, 0.32, 0.5), (0, FRONT - 1.1, 8.35), mats["trim"], {"bevel": 0.03, "target": target})
    add_box("roof-edge-rear", (W + 2.4, 0.32, 0.5), (0, D / 2 + 1.1, 8.35), mats["trim"], {"bevel": 0.03, "target": target})


def side_and_rear(target, mats):
    add_box("body", (W - 2.0, D, H), (0, 0, 0.8 + H / 2), mats["stone"], {"bevel": 0.08, "target": target})
    add_box("plinth", (W + 1.8, D + 1.4, 0.7), (0, 0, 0.35), mats["stone_dark"], {"bevel": 0.06, "target": target})
    add_box("annex", (7.0, 12.0, 5.4), (W / 2 + 2.0, 0, 0.8 + 2.7), mats["stone"], {"bevel": 0.06, "target": target})
    add_box("annex-eave", (7.8, 12.8, 0.36), (W / 2 + 2.0, 0, 0.8 + 5.4), mats["trim"], {"bevel": 0.03, "target": target})
    for index in range(3):
        add_box(f"annex-window-{index}", (1.8, 0.14, 1.25), (W / 2 + 0.2 + index * 2.0, -6.1, 3.6), mats["glass"], {"target": target})
    for side in (-1, 1):
        for row in range(2):
            z = 2.3 + row * 2.7
            for index in range(4):
                y = -D / 2 + 3.0 + index * 3.8
                add_box(f"side-win-{side}-{row}-{index}", (0.16, 1.6, 1.3), (side * (W / 2 - 1.1), y, z), mats["glass"], {"target": target})
    add_box("rear-band", (W - 3.0, 0.18, 0.24), (0, D / 2 + 0.08, 4.7), mats["trim"], {"target": target})
    for index in range(6):
        add_box(f"rear-win-{index}", (1.7, 0.14, 1.2), (-12.0 + index * 4.8, D / 2 + 0.1, 3.0), mats["glass"], {"target": target})
    add_box("rear-door", (4.0, 0.16, 2.8), (2.0, D / 2 + 0.1, 2.2), mats["glass_dark"], {"target": target})


def build(target):
    mats = {
        "stone": material("stone-warm", (0.62, 0.60, 0.54), roughness=0.84),
        "stone_dark": material("stone-dark", (0.34, 0.34, 0.31), roughness=0.9),
        "trim": material("trim-white", (0.84, 0.83, 0.78), roughness=0.7),
        "glass": material("glass-blue", (0.06, 0.14, 0.20), roughness=0.2, metallic=0.2),
        "glass_dark": material("glass-dark", (0.03, 0.07, 0.10), roughness=0.18, metallic=0.3),
        "roof": material("roof-metal", (0.46, 0.49, 0.50), roughness=0.38, metallic=0.45),
        "gold": material("gold", (0.70, 0.50, 0.16), roughness=0.3, metallic=0.7),
    }
    side_and_rear(target, mats)
    ribbon_windows(target, mats)
    clerestory(target, mats)
    entrance(target, mats)
    curved_roof(target, mats)
    add_box("roof-unit", (2.6, 1.8, 0.7), (5.0, 2.0, 10.4), mats["trim"], {"bevel": 0.04, "target": target})


def main():
    clear_scene()
    target = make_collection("B04-Gym")
    build(target)
    finish(target, GLB, BLEND, PREVIEW)


if __name__ == "__main__":
    main()
