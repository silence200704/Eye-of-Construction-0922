"""B01 1号综合楼：浅灰石材、蓝灰四坡顶、两层连续窗带与中央门廊。

 Campus photos do not expose a verified “1号综合楼” elevation; this massing follows the
 low blue-roofed administration building visible in the official campus aerial, and keeps the
 archive's two-storey height. It is a visual reference model, not a survey drawing.
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from scene_kit import add_box, add_hip_roof, add_text, clear_scene, collection as make_collection, finish, material, ROOT  # noqa: E402

GLB = ROOT / "public" / "models" / "b01-comprehensive.glb"
BLEND = ROOT / "assets" / "blender" / "b01-comprehensive.blend"
PREVIEW = ROOT / "docs" / "implementation" / "evidence" / "stage-library-3d" / "b01-preview.png"

W, D, H = 24.0, 18.0, 9.0
FRONT = -D / 2


def facade_windows(target, glass, trim):
    for floor in range(2):
        y = 2.25 + floor * 4.0
        for index in range(9):
            x = -W / 2 + 1.7 + index * 2.55
            add_box(f"front-frame-{floor}-{index}", (1.65, 0.12, 1.75), (x, FRONT - 0.04, y), trim, {"target": target})
            add_box(f"front-window-{floor}-{index}", (1.45, 0.18, 1.55), (x, FRONT - 0.12, y), glass, {"target": target})
            add_box(f"front-sill-{floor}-{index}", (1.82, 0.34, 0.16), (x, FRONT - 0.2, y - 0.9), trim, {"target": target})
        for index in range(4):
            y_side = -D / 2 + 3.2 + index * 3.7
            for side in (-1, 1):
                x = side * (W / 2 + 0.22)
                add_box(f"side-frame-{side}-{floor}-{index}", (0.12, 1.6, 1.75), (x - side * 0.1, y_side, y), trim, {"target": target})
                add_box(f"side-window-{side}-{floor}-{index}", (0.18, 1.4, 1.55), (x, y_side, y), glass, {"target": target})
        for index in range(6):
            x = -9.0 + index * 3.6
            add_box(f"rear-frame-{floor}-{index}", (1.7, 0.12, 1.75), (x, D / 2 + 0.04, y), trim, {"target": target})
            add_box(f"rear-window-{floor}-{index}", (1.5, 0.16, 1.55), (x, D / 2 + 0.12, y), glass, {"target": target})
    for level in range(1, 3):
        add_box(f"floor-band-{level}", (W + 0.5, D + 0.4, 0.22), (0, 0, 0.8 + level * 4.05), trim, {"target": target})


def entrance(target, mats):
    stone = mats["stone"]
    trim = mats["trim"]
    glass = mats["glass"]
    metal = mats["metal"]
    gold = mats["gold"]
    add_box("entrance-bay", (7.2, 1.0, 8.0), (0, FRONT - 0.55, 4.4), stone, {"bevel": 0.05, "target": target})
    add_box("entrance-glass", (4.6, 0.16, 3.2), (0, FRONT - 1.12, 2.3), glass, {"target": target})
    add_box("entrance-door", (2.4, 0.16, 2.8), (0, FRONT - 1.24, 2.1), glass, {"target": target})
    for side in (-1, 1):
        add_box(f"entrance-column-{side}", (0.62, 0.72, 6.4), (side * 3.6, FRONT - 1.0, 3.8), trim, {"bevel": 0.04, "target": target})
        add_box(f"entrance-side-glass-{side}", (1.2, 0.16, 2.9), (side * 1.9, FRONT - 1.12, 2.2), glass, {"target": target})
        add_box(f"door-handle-{side}", (0.08, 0.12, 1.1), (side * 0.3, FRONT - 1.34, 2.3), metal, {"target": target})
    add_box("entrance-head", (8.2, 1.3, 0.5), (0, FRONT - 0.9, 7.0), trim, {"bevel": 0.05, "target": target})
    for step in range(4):
        add_box(f"entry-step-{step}", (9.0, 0.9, 0.34), (0, FRONT - 2.3 - step * 0.75, 0.34 - step * 0.26), stone, {"target": target})
    add_text("sign", "综合楼", 1.25, (0, FRONT - 1.32, 7.72), {"rotation": (math.radians(90), 0, 0), "mat": gold, "extrude": 0.05, "target": target})


def build(target):
    stone = material("stone", (0.60, 0.58, 0.52), roughness=0.84)
    stone_dark = material("stone-dark", (0.34, 0.34, 0.31), roughness=0.9)
    trim = material("trim", (0.82, 0.81, 0.76), roughness=0.72)
    glass = material("glass", (0.06, 0.16, 0.22), roughness=0.18, metallic=0.2)
    roof = material("roof-blue", (0.12, 0.24, 0.36), roughness=0.55, metallic=0.15)
    metal = material("metal", (0.15, 0.16, 0.16), roughness=0.35, metallic=0.55)
    gold = material("gold", (0.70, 0.50, 0.16), roughness=0.3, metallic=0.7)

    add_box("plinth", (W + 2.2, D + 1.6, 0.8), (0, 0, 0.4), stone_dark, {"bevel": 0.08, "target": target})
    add_box("body", (W, D, H), (0, 0, 0.8 + H / 2), stone, {"bevel": 0.10, "target": target})
    add_box("upper-eave", (W + 1.0, D + 0.9, 0.5), (0, 0, 0.8 + H - 0.25), trim, {"bevel": 0.05, "target": target})
    facade_windows(target, glass, trim)
    entrance(target, {"stone": stone, "trim": trim, "glass": glass, "metal": metal, "gold": gold})

    # End pavilions: slightly projecting corner bays give the low block a civic rhythm.
    for side in (-1, 1):
        add_box(f"end-pavilion-{side}", (2.8, D + 0.5, H + 0.8), (side * (W / 2 - 1.1), 0, 0.8 + (H + 0.8) / 2), trim, {"bevel": 0.04, "target": target})
        for level in range(2):
            add_box(f"end-slot-{side}-{level}", (0.16, 2.1, 1.6), (side * (W / 2 + 0.12), 0, 2.25 + level * 4.0), glass, {"target": target})

    add_hip_roof("roof", (W + 2.4, D + 2.0, 2.8), (0, 0, 0.8 + H + 1.4), roof, target)
    add_box("roof-fascia", (W + 2.6, D + 2.2, 0.26), (0, 0, 0.8 + H + 0.18), trim, {"bevel": 0.03, "target": target})
    add_box("roof-unit", (3.6, 2.4, 0.8), (-4.5, 1.5, 0.8 + H + 2.7), stone_dark, {"bevel": 0.05, "target": target})
    add_box("roof-unit-2", (2.2, 1.8, 0.6), (4.0, -2.2, 0.8 + H + 2.5), trim, {"bevel": 0.04, "target": target})

    # Vertical stone ribs along the entrance bay, a signature of the campus's grey civic blocks.
    for index in range(4):
        x = -3.0 + index * 2.0
        add_box(f"front-rib-{index}", (0.22, 0.38, H - 1.6), (x, FRONT - 0.22, 0.8 + H / 2), stone_dark, {"bevel": 0.02, "target": target})


def main():
    clear_scene()
    target = make_collection("B01-Comprehensive")
    build(target)
    finish(target, GLB, BLEND, PREVIEW)


if __name__ == "__main__":
    main()
