#!/usr/bin/env python3
"""Build and export the three V0 universal-interface comparison specimens."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import vtk  # noqa: F401 - CadQuery/OCP needs VTK loaded first on this runtime.
import cadquery as cq
from cadquery import exporters

import interface_a
import interface_b
import interface_c
from common_test_body import (
    CommonParams,
    compound,
    equalize_base_volume,
    load_parameters,
    shape_volume,
)


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


def build_variants(
    p: CommonParams, payload: dict[str, Any]
) -> tuple[dict[str, dict[str, cq.Workplane]], dict[str, Any]]:
    raw = {
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
    raw_pair_volumes = {
        key: shape_volume(parts["base"]) + shape_volume(parts["module"])
        for key, parts in raw.items()
    }
    target = min(raw_pair_volumes.values())
    equalized: dict[str, dict[str, cq.Workplane]] = {}
    removed: dict[str, float] = {}
    for key, parts in raw.items():
        delta = raw_pair_volumes[key] - target
        equalized[key] = {
            "base": equalize_base_volume(parts["base"], delta, p),
            "module": parts["module"],
        }
        removed[key] = delta

    final_pair_volumes = {
        key: shape_volume(parts["base"]) + shape_volume(parts["module"])
        for key, parts in equalized.items()
    }
    volume_report = {
        "raw_pair_volume_mm3": {key: round(value, 3) for key, value in raw_pair_volumes.items()},
        "equalizer_removed_mm3": {key: round(value, 3) for key, value in removed.items()},
        "target_pair_volume_mm3": round(target, 3),
        "final_pair_volume_mm3": {key: round(value, 3) for key, value in final_pair_volumes.items()},
        "maximum_final_difference_mm3": round(
            max(final_pair_volumes.values()) - min(final_pair_volumes.values()), 6
        ),
    }
    return equalized, volume_report


def build_plate(parts: dict[str, dict[str, cq.Workplane]]) -> cq.Workplane:
    x_positions = {"A": -74.0, "B": 0.0, "C": 74.0}
    placed: list[cq.Workplane] = []
    for key in ("A", "B", "C"):
        placed.append(parts[key]["base"].translate((x_positions[key], 42.0, 0.0)))
        placed.append(parts[key]["module"].translate((x_positions[key], -42.0, 0.0)))
    return compound(placed)


def write_dimensions(
    root: Path,
    p: CommonParams,
    payload: dict[str, Any],
    parts: dict[str, dict[str, cq.Workplane]],
    volume_report: dict[str, Any],
) -> None:
    part_volumes = {
        key: {
            name: round(shape_volume(part), 3)
            for name, part in pair.items()
        }
        for key, pair in parts.items()
    }
    dimensions = {
        "status": payload["status"],
        "units": "mm",
        "overall_width": 212.0,
        "overall_depth": 156.0,
        "overall_height": round(
            p.base_thickness
            + max(
                payload["interface_a"]["rail_neck_height"]
                + payload["interface_a"]["rail_cap_height"],
                payload["interface_b"]["hook_neck_height"]
                + payload["interface_b"]["hook_cap_height"],
                payload["interface_c"]["lug_neck_height"]
                + payload["interface_c"]["lug_cap_height"],
            ),
            3,
        ),
        "declared_minimum_wall": p.minimum_wall,
        "common_parameters": payload["common"],
        "interface_parameters": {
            "A": payload["interface_a"],
            "B": payload["interface_b"],
            "C": payload["interface_c"],
        },
        "part_volumes_mm3": part_volumes,
        "material_equalization": volume_report,
        "notes": [
            "All values are V0 experimental inputs, not validated fit dimensions.",
            "The combined plate envelope is verified from the exported mesh during build.",
            "Neutral lower-zone cutouts equalize total A/B/C pair volume after labels and interface features.",
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
    parts, volume_report = build_variants(p, payload)

    for key in ("A", "B", "C"):
        export_part(
            parts[key]["base"],
            root / "step" / f"{key}_base.step",
            root / "stl" / f"{key}_base.stl",
        )
        export_part(
            parts[key]["module"],
            root / "step" / f"{key}_module.step",
            root / "stl" / f"{key}_module.stl",
        )

    plate = build_plate(parts)
    export_part(
        plate,
        root / "step" / "interface-test-plate.step",
        root / "stl" / "interface-test-plate.stl",
    )
    export_part(plate, root / "step" / "main.step", root / "stl" / "main.stl")
    write_dimensions(root, p, payload, parts, volume_report)

    notes = {
        "A": interface_a.design_notes(),
        "B": interface_b.design_notes(),
        "C": interface_c.design_notes(),
    }
    (root / "reports" / "design-notes.json").parent.mkdir(parents=True, exist_ok=True)
    (root / "reports" / "design-notes.json").write_text(
        json.dumps(notes, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
