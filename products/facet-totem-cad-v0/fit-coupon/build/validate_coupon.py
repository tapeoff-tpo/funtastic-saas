#!/usr/bin/env python3
"""Validate fit coupon solids, meshes, inherited dimensions, and assembled interference."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import vtk  # noqa: F401
import cadquery as cq
import trimesh


def volume(part: cq.Workplane) -> float:
    return sum(s.Volume() for s in part.solids().vals())


def main() -> None:
    parser = argparse.ArgumentParser(); parser.add_argument("--project", type=Path, required=True)
    root = parser.parse_args().project.resolve(); parent_root = root.parent
    sys.path.insert(0, str(parent_root / "cad")); sys.path.insert(0, str(root / "cad"))
    from common_facet_block import load_params
    from fit_coupon import load_coupon

    p = load_params(parent_root); c = load_coupon(root)
    fits = ("light", "standard", "firm")
    report = {"status": "pass", "parts": {}, "functional_identity": {}, "assembled": {}, "plate": {}}
    loaded = {}
    for fit in fits:
        for kind in ("socket", "plug"):
            name = f"{fit}_{kind}"
            step = cq.importers.importStep(str(root / "step" / f"{name}.step"))
            mesh = trimesh.load(root / "stl" / f"{name}.stl", force="mesh")
            loaded[name] = step
            item = {
                "step_solid_count": len(step.solids().vals()), "watertight": bool(mesh.is_watertight),
                "is_volume": bool(mesh.is_volume), "extents_mm": [round(float(v), 3) for v in mesh.extents],
                "volume_mm3": round(float(mesh.volume), 3), "first_layer_z_mm": round(float(mesh.bounds[0][2]), 6),
            }
            report["parts"][name] = item
            if item["step_solid_count"] != 1 or not item["watertight"] or not item["is_volume"] or abs(item["first_layer_z_mm"]) > 0.001:
                report["status"] = "fail"

    socket_extents = [report["parts"][f"{f}_socket"]["extents_mm"] for f in fits]
    plug_xy = [report["parts"][f"{f}_plug"]["extents_mm"][:2] for f in fits]
    parent_values = {
        "socket_opening_mm": [p.base["socket_width"], p.base["socket_length"]],
        "socket_depth_mm": p.base["socket_depth"],
        "guide_insertion_depth_mm": p.interface["insertion_depth"],
        "terminal_clearance_mm": p.interface["terminal_clearance"],
        "retention_bead_height_mm": p.interface["retention_bead_height"],
        "retention_bead_length_mm": p.interface["retention_bead_length"],
        "retention_bead_vertical_mm": p.interface["retention_bead_vertical"],
        "pocket_length_mm": p.interface["pocket_length"],
        "pocket_vertical_mm": p.interface["pocket_vertical"],
        "corner_radius_mm": p.module["corner_radius"],
        "guide_chamfer_mm": p.module["chamfer"],
        "minimum_wall_mm": p.module["minimum_wall"],
    }
    report["functional_identity"] = {
        "coupon_declared_values_equal_parent": c["inherited_unchanged"] | {} == ({"facet_footprint": c["inherited_unchanged"]["facet_footprint"]} | parent_values),
        "socket_external_envelopes_identical": socket_extents.count(socket_extents[0]) == len(socket_extents),
        "plug_external_xy_identical": plug_xy.count(plug_xy[0]) == len(plug_xy),
        "socket_volumes_identical_mm3": len({report["parts"][f"{f}_socket"]["volume_mm3"] for f in fits}) == 1,
        "assembly_path": "single straight Z translation",
        "stop_surface_z_mm": p.base["thickness"],
    }
    if not all(v for k, v in report["functional_identity"].items() if isinstance(v, bool)):
        report["status"] = "fail"

    seated_z = p.base["thickness"] - p.interface["insertion_depth"]
    for fit in fits:
        intersection = volume(loaded[f"{fit}_socket"].intersect(loaded[f"{fit}_plug"].translate((0, 0, seated_z))))
        report["assembled"][fit] = {"seated_z_mm": seated_z, "interference_mm3": round(intersection, 6)}

    plate = trimesh.load(root / "stl" / "fit-coupon-plate.stl", force="mesh")
    report["plate"] = {
        "extents_mm": [round(float(v), 3) for v in plate.extents],
        "source_part_count": len(loaded),
        "pairwise_xy_separation_pass": c["coupon"]["plate_column_pitch"] > c["coupon"]["socket_outer_width"] and c["coupon"]["plate_row_pitch"] > c["coupon"]["socket_outer_length"],
        "p2s_build_volume_pass": bool(plate.extents[0] <= 256 and plate.extents[1] <= 256 and plate.extents[2] <= 256),
        "all_components_on_bed": all(report["parts"][name]["first_layer_z_mm"] == 0 for name in report["parts"]),
    }
    if report["plate"]["source_part_count"] != 6 or not report["plate"]["pairwise_xy_separation_pass"] or not report["plate"]["p2s_build_volume_pass"] or not report["plate"]["all_components_on_bed"]:
        report["status"] = "fail"

    out = root / "build" / "validation.json"; out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2)); raise SystemExit(0 if report["status"] == "pass" else 1)


if __name__ == "__main__": main()
