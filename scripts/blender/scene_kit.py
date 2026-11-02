"""Shared Blender helpers for the campus building models.

Each building script builds only its own geometry; scene setup, export and render are shared
so the five GLBs keep one pivot convention (front toward -Y, Z up, ground at z=0).
"""
import math
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
FONT = Path("C:/Windows/Fonts/STSONG.TTF")


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in list(bpy.data.collections):
        if collection.name != "Collection":
            bpy.data.collections.remove(collection)
    for material in list(bpy.data.materials):
        bpy.data.materials.remove(material)


def collection(name):
    item = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(item)
    return item


def material(name, color, roughness=0.8, metallic=0.0, alpha=1.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Alpha"].default_value = alpha
    if alpha < 1.0:
        mat.blend_method = "BLEND"
        mat.use_backface_culling = False
    mat.diffuse_color = (*color, alpha)
    return mat


def add_box(name, size, location, mat, options=None):
    options = options or {}
    bevel = options.get("bevel", 0.0)
    rotation = options.get("rotation", (0, 0, 0))
    target = options.get("target")
    bpy.ops.mesh.primitive_cube_add(size=1, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    if bevel > 0:
        modifier = obj.modifiers.new("edge-bevel", "BEVEL")
        modifier.width = bevel
        modifier.segments = 2
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    _link_only(obj, target)
    return obj


def add_hip_roof(name, size, location, mat, target=None):
    """Hipped roof with a small flat top; built from explicit vertices so it scales predictably."""
    w, d, h = size
    inset = 0.18
    half_w, half_d = w / 2, d / 2
    vertices = [
        (-half_w, -half_d, -h / 2), (half_w, -half_d, -h / 2),
        (half_w, half_d, -h / 2), (-half_w, half_d, -h / 2),
        (-half_w * inset, -half_d * inset, h / 2), (half_w * inset, -half_d * inset, h / 2),
        (half_w * inset, half_d * inset, h / 2), (-half_w * inset, half_d * inset, h / 2),
    ]
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    mesh.validate()
    obj = bpy.data.objects.new(name, mesh)
    obj.location = location
    obj.data.materials.append(mat)
    (target or bpy.context.scene.collection).objects.link(obj)
    return obj


def add_text(name, body, size, location, options):
    rotation = options["rotation"]
    mat = options["mat"]
    extrude = options.get("extrude", 0.06)
    target = options.get("target")
    curve = bpy.data.curves.new(name, type="FONT")
    curve.body = body
    curve.size = size
    curve.extrude = extrude
    curve.align_x = "CENTER"
    curve.align_y = "CENTER"
    curve.space_line = 0.9
    if FONT.exists():
        curve.font = bpy.data.fonts.load(str(FONT))
    obj = bpy.data.objects.new(name, curve)
    obj.location = location
    obj.rotation_euler = rotation
    obj.data.materials.append(mat)
    (target or bpy.context.scene.collection).objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    obj.select_set(False)
    return obj


def _link_only(obj, target):
    for owner in list(obj.users_collection):
        owner.objects.unlink(obj)
    (target or bpy.context.scene.collection).objects.link(obj)


def _bbox(targets):
    low = Vector((math.inf, math.inf, math.inf))
    high = Vector((-math.inf, -math.inf, -math.inf))
    for obj in targets:
        if obj.type != "MESH":
            continue
        for corner in obj.bound_box:
            point = obj.matrix_world @ Vector(corner)
            low = Vector((min(low.x, point.x), min(low.y, point.y), min(low.z, point.z)))
            high = Vector((max(high.x, point.x), max(high.y, point.y), max(high.z, point.z)))
    return low, high


def setup_preview(targets, camera_dir=(0.95, -1.35, 0.72)):
    low, high = _bbox(targets)
    center = (low + high) / 2
    span = max(high.x - low.x, high.z - low.z, high.y - low.y)
    camera_data = bpy.data.cameras.new("preview-camera")
    camera = bpy.data.objects.new("preview-camera", camera_data)
    bpy.context.scene.collection.objects.link(camera)
    direction = Vector(camera_dir).normalized()
    camera.location = center + direction * span * 2.7
    look = center.copy()
    look.z = low.z + (high.z - low.z) * 0.42
    camera.rotation_euler = (look - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera_data.lens = 52
    bpy.context.scene.camera = camera

    bpy.ops.object.light_add(type="SUN", location=center + Vector((-span, -span, span * 1.4)))
    sun = bpy.context.object
    sun.data.energy = 4.0
    sun.data.angle = math.radians(8)
    sun.rotation_euler = (math.radians(35), math.radians(-15), math.radians(-40))
    bpy.ops.object.light_add(type="AREA", location=center + Vector((0, -span * 1.5, span * 0.9)))
    area = bpy.context.object
    area.data.energy = max(1200.0, span * span * 1.2)
    area.data.size = max(12.0, span)
    area.rotation_euler = (math.radians(60), 0, 0)

    world = bpy.context.scene.world
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (0.82, 0.90, 0.93, 1)
    background.inputs["Strength"].default_value = 0.8


def render_preview(path, samples=32):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 1440
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def export_glb(target, path):
    for obj in bpy.context.scene.objects:
        obj.select_set(False)
    for obj in target.objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = next(iter(target.objects))
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_cameras=False,
        export_lights=False,
        export_materials="EXPORT",
    )


def finish(target, glb, blend, preview, camera_dir=(0.95, -1.35, 0.72)):
    setup_preview(list(target.objects), camera_dir)
    blend.parent.mkdir(parents=True, exist_ok=True)
    preview.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(blend))
    export_glb(target, glb)
    render_preview(preview)
    print(f"GLB={glb} bytes={glb.stat().st_size}")
    print(f"BLEND={blend}")
    print(f"PREVIEW={preview}")
