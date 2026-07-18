#!/usr/bin/env python3
"""Generate the Phase 9.1 block-form interface comparison."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import vtk  # noqa: F401
import cadquery as cq
from cadquery import exporters

import interface_a
import interface_b
import interface_c
from common_block_body import BlockParams, assembled_module, compound, load_parameters, shape_volume


def export_part(part: cq.Workplane, step_path: Path, stl_path: Path) -> None:
    step_path.parent.mkdir(parents=True, exist_ok=True)
    stl_path.parent.mkdir(parents=True, exist_ok=True)
    exporters.export(part, str(step_path), exportType="STEP")
    exporters.export(
        part,
        str(stl_path),
        exportType="STL",
        tolerance=0.04,
        angularTolerance=0.08,
    )


def build_variants(p: BlockParams, payload: dict[str, Any]) -> dict[str, dict[str, cq.Workplane]]:
    return {
        "A": {
            "base": interface_a.build_base(p, payload["interface_a"]),
            "module": interface_a.build_module(p, payload["interface_a"]),
        },
        "B": {
            "base": interface_b.build_base(p, payload["interface_b"]),
            "module": interface_b.build_module(p, payload["interface_b"]),
        },
        "C": {
            "base": interface_c.build_base(p, payload["interface_c"]),
            "module": interface_c.build_module(p, payload["interface_c"]),
        },
    }


def build_print_plate(parts: dict[str, dict[str, cq.Workplane]]) -> cq.Workplane:
    placed: list[cq.Workplane] = []
    for key, x in zip(("A", "B", "C"), (-52.0, 0.0, 52.0)):
        placed.append(parts[key]["base"].translate((x, 28.0, 0.0)))
        placed.append(parts[key]["module"].translate((x, -28.0, 0.0)))
    return compound(placed)


def build_exploded_scene(parts: dict[str, dict[str, cq.Workplane]], p: BlockParams) -> cq.Workplane:
    placed: list[cq.Workplane] = []
    for key, x in zip(("A", "B", "C"), (-55.0, 0.0, 55.0)):
        placed.append(parts[key]["base"].translate((x, 0.0, 0.0)))
        placed.append(assembled_module(parts[key]["module"], p, x, -5.0, lift=15.0))
    return compound(placed)


def build_assembled_scene(parts: dict[str, dict[str, cq.Workplane]], p: BlockParams) -> cq.Workplane:
    placed: list[cq.Workplane] = []
    for key, x in zip(("A", "B", "C"), (-50.0, 0.0, 50.0)):
        placed.append(parts[key]["base"].translate((x, 0.0, 0.0)))
        placed.append(assembled_module(parts[key]["module"], p, x, 0.0))
    return compound(placed)


def build_grid_scene(parts: dict[str, dict[str, cq.Workplane]], p: BlockParams) -> cq.Workplane:
    placed: list[cq.Workplane] = []
    keys = ("A", "B", "C", "A")
    positions = (
        (-p.grid_pitch / 2, p.grid_pitch / 2),
        (p.grid_pitch / 2, p.grid_pitch / 2),
        (-p.grid_pitch / 2, -p.grid_pitch / 2),
        (p.grid_pitch / 2, -p.grid_pitch / 2),
    )
    for key, (x, y) in zip(keys, positions):
        placed.append(parts[key]["base"].translate((x, y, 0.0)))
        placed.append(assembled_module(parts[key]["module"], p, x, y))
    return compound(placed)


def export_render_scenes(root: Path, parts: dict[str, dict[str, cq.Workplane]], p: BlockParams) -> None:
    scene_dir = root / "build" / "render-scenes"
    scene_dir.mkdir(parents=True, exist_ok=True)
    scenes = {
        "exploded-comparison.stl": build_exploded_scene(parts, p),
        "assembled-comparison.stl": build_assembled_scene(parts, p),
        "block-grid-mockup.stl": build_grid_scene(parts, p),
        "grip-direction.stl": build_assembled_scene({"A": parts["A"], "B": parts["A"], "C": parts["A"]}, p),
    }
    for name, shape in scenes.items():
        exporters.export(
            shape,
            str(scene_dir / name),
            exportType="STL",
            tolerance=0.05,
            angularTolerance=0.1,
        )


def write_dimensions(
    root: Path,
    p: BlockParams,
    payload: dict[str, Any],
    parts: dict[str, dict[str, cq.Workplane]],
) -> None:
    pair_volumes = {
        key: shape_volume(pair["base"]) + shape_volume(pair["module"])
        for key, pair in parts.items()
    }
    mean = sum(pair_volumes.values()) / len(pair_volumes)
    dimensions = {
        "status": payload["status"],
        "units": "mm",
        "print_plate_nominal_envelope": [148.0, 100.0, 16.0],
        "assembled_nominal_envelope": [44.0, 44.0, 23.0],
        "declared_minimum_wall": p.shell_wall,
        "common_parameters": payload["common"],
        "interface_parameters": {
            "A": payload["interface_a"],
            "B": payload["interface_b"],
            "C": payload["interface_c"],
        },
        "part_volumes_mm3": {
            key: {name: round(shape_volume(part), 3) for name, part in pair.items()}
            for key, pair in parts.items()
        },
        "pair_volumes_mm3": {key: round(value, 3) for key, value in pair_volumes.items()},
        "pair_volume_deviation_from_mean_percent": {
            key: round((value - mean) / mean * 100, 3) for key, value in pair_volumes.items()
        },
        "maximum_pair_volume_spread_percent": round(
            (max(pair_volumes.values()) - min(pair_volumes.values())) / mean * 100, 3
        ),
        "notes": [
            "All values are unvalidated V0 experimental dimensions.",
            "The common visible Base and Module envelopes are identical across A/B/C.",
            "Clearance parameters are independent; no global scale factor controls fit.",
        ],
    }
    (root / "cad" / "dimensions.json").write_text(
        json.dumps(dimensions, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", type=Path, required=True)
    args = parser.parse_args()
    root = args.project.resolve()
    p, payload = load_parameters(root)
    parts = build_variants(p, payload)

    for key in ("A", "B", "C"):
        export_part(parts[key]["base"], root / "step" / f"{key}_base.step", root / "stl" / f"{key}_base.stl")
        export_part(parts[key]["module"], root / "step" / f"{key}_module.step", root / "stl" / f"{key}_module.stl")

    plate = build_print_plate(parts)
    export_part(plate, root / "step" / "block-interface-test-plate.step", root / "stl" / "block-interface-test-plate.stl")
    export_part(plate, root / "step" / "main.step", root / "stl" / "main.stl")
    export_render_scenes(root, parts, p)
    write_dimensions(root, p, payload, parts)

    notes = {"A": interface_a.design_notes(), "B": interface_b.design_notes(), "C": interface_c.design_notes()}
    (root / "reports" / "design-notes.json").write_text(
        json.dumps(notes, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
