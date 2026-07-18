#!/usr/bin/env python3
"""Validate Phase 9.3 solids, meshes, assembly path, and common interface."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import vtk  # noqa: F401
import cadquery as cq
import trimesh


def solid_volume(part: cq.Workplane) -> float:
    return sum(s.Volume() for s in part.solids().vals())


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", type=Path, required=True)
    args = parser.parse_args()
    root = args.project.resolve()
    sys.path.insert(0, str(root / "cad"))
    from common_facet_block import load_params, socket_centers

    p = load_params(root)
    names = ["base_2x2", "block_low", "block_medium", "block_tall", "block_light_fit", "block_standard_fit", "block_firm_fit"]
    report = {"status": "pass", "parts": {}, "assembled": {}, "checks": {}}
    loaded: dict[str, cq.Workplane] = {}

    for name in names:
        step = cq.importers.importStep(str(root / "step" / f"{name}.step"))
        mesh = trimesh.load(root / "stl" / f"{name}.stl", force="mesh")
        loaded[name] = step
        result = {
            "step_solid_count": len(step.solids().vals()),
            "watertight": bool(mesh.is_watertight),
            "is_volume": bool(mesh.is_volume),
            "extents_mm": [round(float(v), 3) for v in mesh.extents],
            "volume_mm3": round(float(mesh.volume), 3),
        }
        report["parts"][name] = result
        if result["step_solid_count"] != 1 or not result["watertight"] or not result["is_volume"]:
            report["status"] = "fail"

    base = loaded["base_2x2"]
    x, y = socket_centers(p)[0]
    insertion_z = p.base["thickness"] - p.interface["insertion_depth"]
    for name in names[1:]:
        block = loaded[name].translate((x, y, insertion_z))
        interference = solid_volume(base.intersect(block))
        report["assembled"][name] = {"interference_mm3": round(interference, 6)}
        # Retention may intentionally create a very small local interference; broad collision is a failure.
        if interference > 2.0:
            report["status"] = "fail"

    gap = p.base["socket_pitch"] - p.module["footprint_width"]
    report["checks"] = {
        "common_footprint": all(
            abs(report["parts"][n]["extents_mm"][0] - p.module["footprint_width"]) < 0.05
            and abs(report["parts"][n]["extents_mm"][1] - p.module["footprint_length"]) < 0.05
            for n in names[1:]
        ),
        "visible_finger_gap_mm": round(gap, 3),
        "finger_gap_meets_declared": gap >= p.interface["finger_gap"],
        "base_fits_p2s": p.base["width"] <= 256 and p.base["length"] <= 256,
        "declared_minimum_wall_mm": p.module["minimum_wall"],
        "minimum_wall_at_least_four_nozzle_lines": p.module["minimum_wall"] >= 1.6,
        "common_insertion_depth_mm": p.interface["insertion_depth"],
        "terminal_clearance_mm": p.interface["terminal_clearance"],
        "straight_assembly_path": "single translation along +Z/-Z; no rotation or lateral motion",
    }
    if not all((report["checks"]["common_footprint"], report["checks"]["finger_gap_meets_declared"], report["checks"]["base_fits_p2s"], report["checks"]["minimum_wall_at_least_four_nozzle_lines"])):
        report["status"] = "fail"

    out = root / "build" / "validation" / "geometry.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    raise SystemExit(0 if report["status"] == "pass" else 1)


if __name__ == "__main__":
    main()
