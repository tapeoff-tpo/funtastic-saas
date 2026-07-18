#!/usr/bin/env python3
"""Render only generated Phase 9.3 CAD in Blender; no generated imagery."""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(sys.argv[sys.argv.index("--") + 1]).resolve()
OUT = ROOT / "renders"
OUT.mkdir(parents=True, exist_ok=True)
PARAMS = json.loads((ROOT / "parameters" / "parameters.json").read_text())
INSERT_Z = PARAMS["base"]["thickness"] - PARAMS["interface"]["insertion_depth"]
PITCH = PARAMS["base"]["socket_pitch"]


def mat(name, color, roughness=0.62):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1.0)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    return m


IVORY = mat("Warm Ivory Base", (0.82, 0.79, 0.69), 0.72)
BLUE = mat("Vivid Blue", (0.08, 0.28, 0.86), 0.58)
MINT = mat("Fresh Mint", (0.32, 0.76, 0.58), 0.62)
ORANGE = mat("Warm Orange", (0.96, 0.31, 0.08), 0.58)
LILAC = mat("Soft Lilac", (0.67, 0.48, 0.87), 0.62)
YELLOW = mat("Butter Yellow", (0.98, 0.69, 0.10), 0.60)
GRAY = mat("Fit Gray", (0.38, 0.42, 0.46), 0.68)
TEXT = mat("Text", (0.07, 0.08, 0.09), 0.55)


def reset():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def import_stl(name, material, location=(0, 0, 0), rotation=(0, 0, 0)):
    bpy.ops.wm.stl_import(filepath=str(ROOT / "stl" / f"{name}.stl"))
    obj = next(o for o in bpy.context.selected_objects if o.type == "MESH")
    obj.name = name
    obj.location = location
    obj.rotation_euler = rotation
    obj.data.materials.append(material)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.shade_smooth_by_angle()
    return obj


def add_floor(size=420):
    floor = mat("Studio Floor", (0.72, 0.72, 0.69), 0.82)
    bpy.ops.mesh.primitive_plane_add(size=size, location=(0, 0, -0.2))
    bpy.context.object.data.materials.append(floor)


def add_text(value, location, size=5.0, rotation=(0, 0, 0)):
    bpy.ops.object.text_add(location=location, rotation=rotation)
    obj = bpy.context.object
    obj.data.body = value
    obj.data.align_x = "CENTER"
    obj.data.size = size
    obj.data.extrude = 0.12
    obj.data.bevel_depth = 0.03
    obj.data.materials.append(TEXT)
    return obj


def look_at(obj, point):
    obj.rotation_euler = (Vector(point) - obj.location).to_track_quat("-Z", "Y").to_euler()


def setup(camera_location, target=(0, 0, 15), ortho=None, resolution=(1200, 800)):
    world = bpy.context.scene.world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.38, 0.40, 0.42, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
    cam_data = bpy.data.cameras.new("Camera")
    cam = bpy.data.objects.new("Camera", cam_data)
    bpy.context.collection.objects.link(cam)
    cam.location = camera_location
    if ortho:
        cam_data.type = "ORTHO"; cam_data.ortho_scale = ortho
    else:
        cam_data.lens = 58
    look_at(cam, target)
    bpy.context.scene.camera = cam
    for name, loc, energy, size in (
        ("Key", (150, -150, 200), 52000, 90),
        ("Fill", (-130, -70, 100), 30000, 80),
        ("Rim", (50, 150, 170), 38000, 70),
    ):
        data = bpy.data.lights.new(name, "AREA"); data.energy = energy; data.shape = "DISK"; data.size = size
        light = bpy.data.objects.new(name, data); bpy.context.collection.objects.link(light); light.location = loc; look_at(light, target)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = resolution
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.look = "AgX - Medium High Contrast"


def render(name):
    bpy.context.scene.render.filepath = str(OUT / name)
    bpy.ops.render.render(write_still=True)


def centers():
    return [(-PITCH/2, PITCH/2), (PITCH/2, PITCH/2), (-PITCH/2, -PITCH/2), (PITCH/2, -PITCH/2)]


def assembled_scene(name="assembled-2x2.png", camera=(170, -190, 150)):
    reset(); add_floor(); import_stl("base_2x2", IVORY)
    blocks = (("block_low", MINT), ("block_medium", BLUE), ("block_tall", ORANGE), ("block_standard_fit", LILAC))
    for (part, material), (x, y) in zip(blocks, centers()):
        import_stl(part, material, (x, y, INSERT_Z))
    setup(camera, (0, 0, 20)); render(name)


def cad_overview():
    reset(); add_floor(); import_stl("base_2x2", IVORY, (-68, 0, 0))
    for name, material, x in (("block_low", MINT, 18), ("block_medium", BLUE, 70), ("block_tall", ORANGE, 122)):
        import_stl(name, material, (x, 0, 0))
    setup((205, -250, 170), (20, 0, 20), ortho=235); render("cad-overview.png")


def height_family():
    reset(); add_floor()
    for name, material, x, label in (("block_low", MINT, -54, "LOW"), ("block_medium", BLUE, 0, "MEDIUM"), ("block_tall", ORANGE, 54, "TALL")):
        import_stl(name, material, (x, 0, 0)); add_text(label, (x, -35, 0.2), 4.0)
    setup((145, -190, 105), (0, 0, 20), ortho=180); render("height-family.png")


def fit_variants():
    reset(); add_floor()
    for name, material, x, label in (("block_light_fit", MINT, -54, "LIGHT"), ("block_standard_fit", BLUE, 0, "STANDARD"), ("block_firm_fit", ORANGE, 54, "FIRM")):
        import_stl(name, material, (x, 0, 0)); add_text(label, (x, -35, 0.2), 4.0)
    setup((150, -195, 110), (0, 0, 18), ortho=180); render("fit-variants.png")


def push_pull():
    reset(); add_floor(); import_stl("base_2x2", IVORY)
    lifts = (0, 11, 25, 42)
    blocks = (("block_low", MINT), ("block_medium", BLUE), ("block_tall", ORANGE), ("block_standard_fit", LILAC))
    for (name, material), (x, y), lift in zip(blocks, centers(), lifts):
        import_stl(name, material, (x, y, INSERT_Z + lift))
    setup((175, -200, 155), (0, 0, 30)); render("push-pull-sequence.png")


def orthographic_views():
    for filename, camera, target, scale in (
        ("front.png", (0, -250, 30), (0, 0, 25), 145),
        ("side.png", (250, 0, 30), (0, 0, 25), 145),
        ("top.png", (0, 0, 280), (0, 0, 0), 145),
        ("perspective.png", (175, -200, 150), (0, 0, 20), None),
    ):
        reset(); add_floor(); import_stl("base_2x2", IVORY)
        blocks = (("block_low", MINT), ("block_medium", BLUE), ("block_tall", ORANGE), ("block_standard_fit", LILAC))
        for (name, material), (x, y) in zip(blocks, centers()): import_stl(name, material, (x, y, INSERT_Z))
        setup(camera, target, ortho=scale); render(filename)


cad_overview(); assembled_scene(); push_pull(); height_family(); fit_variants(); orthographic_views()
