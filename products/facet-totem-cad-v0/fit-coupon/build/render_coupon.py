#!/usr/bin/env python3
"""Render the actual fit coupon STL geometry in Blender."""

from __future__ import annotations

import sys
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(sys.argv[sys.argv.index("--") + 1]).resolve(); OUT = ROOT / "renders"; OUT.mkdir(parents=True, exist_ok=True)
SEATED_Z = 5.2


def material(name, color, roughness=0.64):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name); m.diffuse_color = (*color, 1)
    m.use_nodes = True; b = m.node_tree.nodes.get("Principled BSDF"); b.inputs["Base Color"].default_value = (*color, 1); b.inputs["Roughness"].default_value = roughness
    return m


IVORY = material("Coupon Ivory", (0.82, 0.79, 0.69), 0.74)
LIGHT = material("Light Mint", (0.32, 0.76, 0.58), 0.62)
STANDARD = material("Standard Blue", (0.08, 0.28, 0.86), 0.58)
FIRM = material("Firm Orange", (0.96, 0.31, 0.08), 0.60)
TEXT = material("Label", (0.07, 0.08, 0.09), 0.55)


def reset(): bpy.ops.object.select_all(action="SELECT"); bpy.ops.object.delete(use_global=False)


def import_stl(name, mat, location=(0, 0, 0)):
    bpy.ops.wm.stl_import(filepath=str(ROOT / "stl" / f"{name}.stl")); obj = next(o for o in bpy.context.selected_objects if o.type == "MESH")
    obj.name = name; obj.location = location; obj.data.materials.append(mat); bpy.context.view_layer.objects.active = obj; bpy.ops.object.shade_smooth_by_angle(); return obj


def label(value, location):
    bpy.ops.object.text_add(location=location); obj=bpy.context.object; obj.data.body=value; obj.data.align_x="CENTER"; obj.data.size=4.5; obj.data.extrude=0.1; obj.data.materials.append(TEXT)


def floor():
    f=material("Floor", (0.72,0.72,0.69),0.82); bpy.ops.mesh.primitive_plane_add(size=350,location=(0,0,-0.2)); bpy.context.object.data.materials.append(f)


def look(obj, target): obj.rotation_euler=(Vector(target)-obj.location).to_track_quat("-Z","Y").to_euler()


def setup(camera=(150,-190,125), target=(0,0,8), ortho=190):
    world=bpy.context.scene.world; world.use_nodes=True; world.node_tree.nodes["Background"].inputs["Color"].default_value=(0.38,0.40,0.42,1); world.node_tree.nodes["Background"].inputs["Strength"].default_value=0.9
    cd=bpy.data.cameras.new("Camera"); cam=bpy.data.objects.new("Camera",cd); bpy.context.collection.objects.link(cam); cam.location=camera; cd.type="ORTHO"; cd.ortho_scale=ortho; look(cam,target); bpy.context.scene.camera=cam
    for name,loc,energy,size in (("Key",(150,-150,190),52000,90),("Fill",(-130,-70,100),30000,80),("Rim",(50,150,150),38000,70)):
        d=bpy.data.lights.new(name,"AREA"); d.energy=energy; d.shape="DISK"; d.size=size; o=bpy.data.objects.new(name,d); bpy.context.collection.objects.link(o); o.location=loc; look(o,target)
    s=bpy.context.scene; s.render.engine="BLENDER_EEVEE"; s.render.resolution_x=1200; s.render.resolution_y=800; s.render.resolution_percentage=100; s.render.image_settings.file_format="PNG"; s.view_settings.look="AgX - Medium High Contrast"


def render(name): bpy.context.scene.render.filepath=str(OUT/name); bpy.ops.render.render(write_still=True)


FITS=(("light",LIGHT,-60),("standard",STANDARD,0),("firm",FIRM,60))


def overview():
    reset(); floor()
    for fit,mat,x in FITS:
        import_stl(f"{fit}_socket",IVORY,(x,30,0)); import_stl(f"{fit}_plug",mat,(x,-32,0)); label(fit.upper(),(x,-60,0.2))
    setup(); render("fit-coupon-overview.png")


def exploded():
    reset(); floor()
    for fit,mat,x in FITS:
        import_stl(f"{fit}_socket",IVORY,(x,0,0)); import_stl(f"{fit}_plug",mat,(x,0,25)); label(fit.upper(),(x,-38,0.2))
    setup((145,-185,120),(0,0,12),185); render("fit-coupon-exploded.png")


def assembled():
    reset(); floor()
    for fit,mat,x in FITS:
        import_stl(f"{fit}_socket",IVORY,(x,0,0)); import_stl(f"{fit}_plug",mat,(x,0,SEATED_Z)); label(fit.upper(),(x,-38,0.2))
    setup((145,-185,105),(0,0,7),185); render("fit-coupon-assembled.png")


overview(); exploded(); assembled()
