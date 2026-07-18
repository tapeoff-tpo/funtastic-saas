"""Render Phase 9.1 block-form interface comparisons in Blender."""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def project_root() -> Path:
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if not args:
        raise SystemExit("Pass the project root after --")
    return Path(args[0]).resolve()


ROOT = project_root()
OUTPUT = ROOT / "renders"
OUTPUT.mkdir(parents=True, exist_ok=True)


def material(name: str, color: tuple[float, float, float, float], roughness: float = 0.58):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.diffuse_color = color
    mat.use_nodes = True
    node = mat.node_tree.nodes.get("Principled BSDF")
    node.inputs["Base Color"].default_value = color
    node.inputs["Roughness"].default_value = roughness
    node.inputs["Metallic"].default_value = 0.0
    return mat


BASE_MAT = material("Warm White Base", (0.88, 0.90, 0.88, 1.0), 0.7)
COLORS = {
    "A": material("Sage A", (0.46, 0.79, 0.61, 1.0), 0.62),
    "B": material("Powder Blue B", (0.48, 0.72, 0.94, 1.0), 0.62),
    "C": material("Coral C", (0.98, 0.59, 0.49, 1.0), 0.62),
}
OLD_MAT = material("Phase 9 Gray", (0.42, 0.45, 0.48, 1.0), 0.68)
ARROW_MAT = material("Direction Orange", (0.98, 0.58, 0.16, 1.0), 0.48)
TEXT_MAT = material("Label", (0.08, 0.10, 0.11, 1.0), 0.55)


def reset_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def import_stl(
    path: Path,
    name: str,
    mat,
    location=(0.0, 0.0, 0.0),
    rotation=(0.0, 0.0, 0.0),
    scale=(1.0, 1.0, 1.0),
):
    bpy.ops.wm.stl_import(filepath=str(path))
    obj = next(item for item in bpy.context.selected_objects if item.type == "MESH")
    obj.name = name
    obj.location = location
    obj.rotation_euler = rotation
    obj.scale = scale
    obj.data.materials.append(mat)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.shade_smooth_by_angle()
    return obj


def add_text(text: str, location, size: float = 6.0, rotation=(0.0, 0.0, 0.0)):
    bpy.ops.object.text_add(location=location, rotation=rotation)
    obj = bpy.context.object
    obj.data.body = text
    obj.data.align_x = "CENTER"
    obj.data.align_y = "CENTER"
    obj.data.size = size
    obj.data.extrude = 0.15
    obj.data.bevel_depth = 0.04
    obj.data.materials.append(TEXT_MAT)
    return obj


def add_arrow(start: Vector, end: Vector, radius: float = 0.7):
    direction = end - start
    length = direction.length
    direction.normalize()
    shaft_length = max(0.1, length - 4.0)
    shaft_center = start + direction * shaft_length / 2
    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=radius, depth=shaft_length, location=shaft_center)
    shaft = bpy.context.object
    shaft.rotation_mode = "QUATERNION"
    shaft.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(direction)
    shaft.data.materials.append(ARROW_MAT)
    bpy.ops.mesh.primitive_cone_add(vertices=32, radius1=2.2, radius2=0.0, depth=4.0, location=end - direction * 2.0)
    head = bpy.context.object
    head.rotation_mode = "QUATERNION"
    head.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(direction)
    head.data.materials.append(ARROW_MAT)


def add_floor(size: float = 400.0):
    floor_mat = material("Floor", (0.76, 0.78, 0.77, 1.0), 0.78)
    bpy.ops.mesh.primitive_plane_add(size=size, location=(0, 0, -0.15))
    bpy.context.object.data.materials.append(floor_mat)


def look_at(obj, point: tuple[float, float, float]) -> None:
    obj.rotation_euler = (Vector(point) - obj.location).to_track_quat("-Z", "Y").to_euler()


def setup_lighting(camera_location, target, ortho_scale=None):
    world = bpy.context.scene.world
    world.color = (0.16, 0.18, 0.19)
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.16, 0.18, 0.19, 1.0)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.8

    camera_data = bpy.data.cameras.new("Camera")
    camera = bpy.data.objects.new("Camera", camera_data)
    bpy.context.collection.objects.link(camera)
    camera.location = camera_location
    if ortho_scale:
        camera_data.type = "ORTHO"
        camera_data.ortho_scale = ortho_scale
    else:
        camera_data.lens = 58
    look_at(camera, target)
    bpy.context.scene.camera = camera

    for name, loc, energy, size in (
        ("Key", (120, -120, 180), 65000, 95),
        ("Fill", (-130, -40, 90), 38000, 80),
        ("Rim", (40, 150, 150), 48000, 70),
    ):
        data = bpy.data.lights.new(name, "AREA")
        data.energy = energy
        data.shape = "DISK"
        data.size = size
        light = bpy.data.objects.new(name, data)
        bpy.context.collection.objects.link(light)
        light.location = loc
        look_at(light, target)

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1200
    scene.render.resolution_y = 800
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = False
    scene.view_settings.look = "AgX - Medium High Contrast"


def render(name: str) -> None:
    scene = bpy.context.scene
    scene.render.filepath = str(OUTPUT / name)
    bpy.ops.render.render(write_still=True)


def add_pair(key: str, x: float, y: float, assembled: bool, lift: float = 0.0):
    import_stl(ROOT / "stl" / f"{key}_base.stl", f"{key} Base", BASE_MAT, (x, y, 0))
    if assembled:
        import_stl(
            ROOT / "stl" / f"{key}_module.stl",
            f"{key} Module",
            COLORS[key],
            (x, y, 23.0 + lift),
            (math.pi, 0, 0),
        )
    else:
        import_stl(
            ROOT / "stl" / f"{key}_module.stl",
            f"{key} Module",
            COLORS[key],
            (x, y - 48.0, 0.0),
            (0.0, 0.0, 0.0),
        )


def exploded_comparison():
    reset_scene(); add_floor()
    for key, x in zip("ABC", (-55.0, 0.0, 55.0)):
        add_pair(key, x, 24.0, assembled=False)
        add_text(key, (x, -51, 0.4), 6.0)
    setup_lighting((170, -230, 185), (0, -2, 8), ortho_scale=205)
    render("exploded-comparison.png")


def assembled_comparison(camera=(170, -210, 125), name="assembled-comparison.png"):
    reset_scene(); add_floor()
    for key, x in zip("ABC", (-50.0, 0.0, 50.0)):
        add_pair(key, x, 0.0, assembled=True)
        add_text(key, (x, -26, 0.4), 5.5)
    setup_lighting(camera, (0, 0, 10))
    render(name)


def front_and_side():
    assembled_comparison((0, -230, 24), "front.png")
    reset_scene(); add_floor(); add_pair("A", 0, 0, assembled=True); add_text("COMMON BLOCK PROFILE", (0, -28, 0.4), 4.0)
    setup_lighting((150, 0, 25), (0, 0, 10), ortho_scale=65)
    render("side.png")
    assembled_comparison((175, -215, 145), "perspective.png")


def grip_direction():
    reset_scene(); add_floor()
    import_stl(ROOT / "stl" / "A_base.stl", "A Base", BASE_MAT, (0, 0, 0))
    import_stl(
        ROOT / "stl" / "A_module.stl", "A Module", COLORS["A"],
        (0, -6, 34.0), (math.pi, 0, 0),
    )
    add_arrow(Vector((-42, -6, 35)), Vector((-20, -6, 35)))
    add_arrow(Vector((42, -6, 35)), Vector((20, -6, 35)))
    add_text("GRIP SIDES, THEN LOWER + SLIDE", (0, -34, 1.0), 4.2)
    setup_lighting((115, -155, 105), (0, 0, 18), ortho_scale=100)
    render("grip-direction.png")


def grid_mockup():
    reset_scene(); add_floor()
    positions = ((-23.5, 23.5), (23.5, 23.5), (-23.5, -23.5), (23.5, -23.5))
    for key, (x, y) in zip(("A", "B", "C", "A"), positions):
        add_pair(key, x, y, assembled=True)
    add_text("2 x 2 PLATFORM ARRAY", (0, -59, 0.5), 5.0)
    setup_lighting((125, -150, 145), (0, 0, 10), ortho_scale=145)
    render("block-grid-mockup.png")


def phase_comparison():
    reset_scene(); add_floor(500)
    old_path = ROOT.parent / "platform-interface-v0" / "stl" / "main.stl"
    import_stl(old_path, "Phase 9 Flat Coupons", OLD_MAT, (-68, 0, 0), scale=(0.48, 0.48, 0.48))
    positions = ((45, 23.5), (92, 23.5), (45, -23.5), (92, -23.5))
    for key, (x, y) in zip(("A", "B", "C", "A"), positions):
        add_pair(key, x, y, assembled=True)
    add_text("PHASE 9: FLAT COUPONS", (-68, -55, 0.5), 4.4)
    add_text("PHASE 9.1: BLOCK FAMILY", (68.5, -55, 0.5), 4.4)
    setup_lighting((210, -255, 205), (5, 0, 10), ortho_scale=245)
    render("phase9-vs-phase9-1.png")


exploded_comparison()
assembled_comparison()
front_and_side()
grip_direction()
grid_mockup()
phase_comparison()
