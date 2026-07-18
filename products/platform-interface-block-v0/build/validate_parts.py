#!/usr/bin/env python3
"""Validate individual block interface exports and nominal assembled clearance."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import vtk  # noqa: F401
import cadquery as cq
import trimesh


def volume(shape: cq.Workplane) -> float:
    return sum(solid.Volume() for solid in shape.solids().vals())


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", type=Path, required=True)
    args = parser.parse_args()
    root = args.project.resolve()
    sys.path.insert(0, str(root / "cad"))
    from common_block_body import assembled_module, load_parameters

    params, _payload = load_parameters(root)
    report = {"status": "pass", "parts": {}, "assembled_interference_mm3": {}}
    expected = {
        "base": [params.base_width, params.base_height],
        "module": [params.module_width, params.module_height],
    }

    for key in "ABC":
        loaded = {}
        for kind in ("base", "module"):
            stl_path = root / "stl" / f"{key}_{kind}.stl"
            step_path = root / "step" / f"{key}_{kind}.step"
            mesh = trimesh.load(stl_path, force="mesh")
            step = cq.importers.importStep(str(step_path))
            loaded[kind] = step
            extents = [round(float(value), 3) for value in mesh.extents]
            common_xy = all(abs(extents[index] - expected[kind][index]) < 0.01 for index in (0, 1))
            report["parts"][f"{key}_{kind}"] = {
                "watertight": bool(mesh.is_watertight),
                "is_volume": bool(mesh.is_volume),
                "step_solid_count": len(step.solids().vals()),
                "extents_mm": extents,
                "common_xy_envelope": common_xy,
            }
            if not (mesh.is_watertight and mesh.is_volume and len(step.solids().vals()) == 1 and common_xy):
                report["status"] = "fail"

        assembled = assembled_module(loaded["module"], params, 0.0, 0.0)
        interference = volume(loaded["base"].intersect(assembled))
        report["assembled_interference_mm3"][key] = round(interference, 6)
        if interference > 0.01:
            report["status"] = "fail"

    output = root / "build" / "validation" / "parts.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    raise SystemExit(0 if report["status"] == "pass" else 1)


if __name__ == "__main__":
    main()
