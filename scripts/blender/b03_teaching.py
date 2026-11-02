"""B03 3号教学楼：参考校方“龙子湖教学楼”实景的深灰板楼、白色厚挑檐、竖向凹槽与端部外挂楼梯。

The official photo shows a five-storey teaching block; the demo archive has three storeys, so
the reference facade is compressed to three storeys at runtime (visual model, not a survey).
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from scene_kit import add_box, add_text, clear_scene, collection as make_collection, finish, material, ROOT  # noqa: E402

GLB = ROOT / "public" / "models" / "b03-teaching.glb"
BLEND = ROOT / "assets" / "blender" / "b03-teaching.blend"
PREVIEW = ROOT / "docs" / "implementation" / "evidence" / "stage-library-3d" / "b03-preview.png"

W, D, H = 30.0, 16.0, 14.0
FRONT = -D / 2


def front_facade(target, mats):
    add_box("body", (W - 4.0, D, H), (1.0, 0, 0.8 + H / 2), mats["wall"], {"bevel": 0.08, "target": target})
    add_box("eave", (W + 1.4, D + 1.4, 0.6), (0, 0, 0.8 + H - 0.3), mats["trim"], {"bevel": 0.05, "target": target})
    add_box("upper-fascia", (W + 0.6, D + 0.6, 0.55), (0, 0, 0.8 + H - 0.85), mats["trim"], {"bevel": 0.03, "target": target})
    for bay in range(7):
        x = -W / 2 + 3.4 + bay * 4.0
        add_box(f"groove-{bay}", (0.62, 0.2, H - 2.0), (x, FRONT - 0.08, 0.8 + H / 2), mats["wall_dark"], {"target": target})
        for row in range(3):
            z = 2.6 + row * 3.65
            add_box(f"slot-win-{bay}-{row}", (0.30, 0.16, 1.25), (x, FRONT - 0.2, z), mats["glass"], {"target": target})
            add_box(f"square-hole-{bay}-{row}", (0.16, 0.12, 0.16), (x - 0.55, FRONT - 0.22, z + 0.95), mats["glass"], {"target": target})
        add_box(f"rib-{bay}", (0.34, 0.7, H - 1.2), (x - 1.8, FRONT - 0.35, 0.8 + H / 2), mats["wall"], {"bevel": 0.02, "target": target})
    add_box("entry-bay", (5.0, 1.0, 7.0), (-7.5, FRONT - 0.3, 3.9), mats["wall_dark"], {"bevel": 0.05, "target": target})
    add_box("entry-glass", (3.4, 0.16, 4.4), (-7.5, FRONT - 0.92, 3.1), mats["glass"], {"target": target})
    add_box("entry-canopy", (6.4, 2.2, 0.34), (-7.5, FRONT - 1.5, 6.2), mats["trim"], {"bevel": 0.04, "target": target})
    for step in range(3):
        add_box(f"entry-step-{step}", (7.0, 0.8, 0.28), (-7.5, FRONT - 2.3 - step * 0.65, 0.28 - step * 0.2), mats["wall"], {"target": target})
    add_text("sign", "教学楼", 1.3, (-7.5, FRONT - 1.2, 7.3), {"rotation": (math.radians(90), 0, 0), "mat": mats["gold"], "extrude": 0.05, "target": target})


def external_stair(target, mats):
    x = -12.9
    length, rise = 10.0, 3.7
    for flight in range(3):
        start = FRONT + 3.0 + (length if flight % 2 == 1 else 0.0)
        direction = 1 if flight % 2 == 0 else -1
        z0 = 0.8 + flight * rise
        for step in range(9):
            y = start + direction * (step + 0.5) * length / 9
            z = z0 + (step + 1) * rise / 9
            add_box(f"stair-f{flight}-{step}", (1.8, length / 9 + 0.05, 0.22), (x, y, z), mats["trim"], {"target": target})
        end_y = start + direction * length
        add_box(f"stair-landing-{flight}", (2.1, 1.8, 0.25), (x, end_y, z0 + rise), mats["trim"], {"target": target})
        rail_len = math.hypot(length, rise)
        angle = math.atan2(rise, length) * direction
        for side in (-1, 1):
            add_box(f"stair-rail-{flight}-{side}", (0.08, rail_len, 0.08),
                    (x + side * 0.92, start + direction * length / 2, z0 + rise / 2 + 1.0),
                    mats["metal"], {"target": target, "rotation": (angle, 0, 0)})
        for post in range(3):
            y = start + direction * (post + 0.5) * length / 3
            z = z0 + (post + 0.5) * rise / 3
            add_box(f"stair-post-{flight}-{post}", (0.08, 0.08, 1.0), (x + 0.92, y, z + 0.5), mats["metal"], {"target": target})


def side_and_rear(target, mats):
    for side in (-1, 1):
        x = -12.1 if side == -1 else 14.1
        for row in range(3):
            z = 2.6 + row * 3.65
            for index in range(4):
                y = -D / 2 + 2.4 + index * 3.5
                add_box(f"side-win-{side}-{row}-{index}", (0.16, 1.3, 1.25), (x, y, z), mats["glass"], {"target": target})
    add_box("link-wing", (8.0, 10.0, 8.5), (W / 2 + 3.6, 1.0, 0.8 + 4.25), mats["wall"], {"bevel": 0.06, "target": target})
    add_box("link-eave", (8.8, 10.8, 0.4), (W / 2 + 3.6, 1.0, 0.8 + 8.4), mats["trim"], {"bevel": 0.03, "target": target})
    add_box("link-bridge", (2.4, 4.0, 1.0), (W / 2 + 0.5, FRONT + 3.4, 5.2), mats["trim"], {"bevel": 0.02, "target": target})
    for index in range(3):
        add_box(f"link-front-frame-{index}", (2.2, 0.12, 1.55), (W / 2 + 2.2 + index * 2.4, -4.06, 4.3), mats["trim"], {"target": target})
        add_box(f"link-front-window-{index}", (2.0, 0.14, 1.35), (W / 2 + 2.2 + index * 2.4, -4.14, 4.3), mats["glass"], {"target": target})
    add_box("rear-band", (W - 4.0, 0.3, 0.2), (1.0, D / 2 + 0.05, 8.0), mats["trim"], {"target": target})
    for index in range(6):
        x = -12.5 + index * 5.0
        add_box(f"rear-win-{index}", (1.5, 0.14, 1.2), (x, D / 2 + 0.08, 5.0), mats["glass"], {"target": target})


def build(target):
    mats = {
        "wall": material("wall-grey", (0.33, 0.34, 0.33), roughness=0.88),
        "wall_dark": material("wall-recess", (0.19, 0.20, 0.20), roughness=0.92),
        "trim": material("trim-white", (0.83, 0.83, 0.79), roughness=0.7),
        "glass": material("glass", (0.04, 0.09, 0.12), roughness=0.2, metallic=0.2),
        "metal": material("black-steel", (0.08, 0.09, 0.09), roughness=0.35, metallic=0.55),
        "gold": material("gold", (0.70, 0.50, 0.16), roughness=0.3, metallic=0.7),
    }
    add_box("plinth", (W + 1.4, D + 1.2, 0.8), (0, 0, 0.4), mats["wall_dark"], {"bevel": 0.06, "target": target})
    front_facade(target, mats)
    external_stair(target, mats)
    side_and_rear(target, mats)
    add_box("roof", (W - 4.0, D, 0.3), (1.0, 0, 0.8 + H + 0.15), mats["wall_dark"], {"target": target})
    add_box("roof-unit", (4.0, 2.4, 0.8), (4.0, 2.0, 0.8 + H + 0.9), mats["trim"], {"bevel": 0.04, "target": target})
    add_box("roof-unit-2", (2.6, 1.8, 0.6), (-3.0, -2.5, 0.8 + H + 0.8), mats["wall"], {"bevel": 0.03, "target": target})


def main():
    clear_scene()
    target = make_collection("B03-Teaching")
    build(target)
    finish(target, GLB, BLEND, PREVIEW, camera_dir=(-1.0, -1.35, 0.62))


if __name__ == "__main__":
    main()
