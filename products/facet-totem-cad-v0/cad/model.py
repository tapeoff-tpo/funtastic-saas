#!/usr/bin/env python3
"""Generate Facet Totem Phase 9.3 CAD, exports, scenes, and metadata."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import vtk  # noqa: F401
import cadquery as cq
from cadquery import exporters

from base_2x2 import build_base
from common_facet_block import Params, compound, load_params, socket_centers, volume
from test_blocks import build_fit_family, build_height_family


def export(part: cq.Workplane, step: Path, stl: Path) -> None:
    step.parent.mkdir(parents=True, exist_ok=True)
    stl.parent.mkdir(parents=True, exist_ok=True)
    exporters.export(part, str(step), exportType="STEP")
    exporters.export(part, str(stl), exportType="STL", tolerance=0.035, angularTolerance=0.08)


def seated(block: cq.Workplane, p: Params, x: float, y: float, lift: float = 0.0) -> cq.Workplane:
    # Model blocks are authored print-ready with the guide down.
    return block.translate((x, y, p.base["thickness"] - p.interface["insertion_depth"] + lift))


def print_plate(base: cq.Workplane, heights: dict[str, cq.Workplane], fits: dict[str, cq.Workplane]) -> cq.Workplane:
    parts = [base.translate((-55, 0, 0))]
    for name, x, y in (
        ("low", 40, 52), ("medium", 92, 52),
        ("tall", 40, 0), ("light_fit", 92, 0),
        ("standard_fit", 40, -52), ("firm_fit", 92, -52),
    ):
        part = heights[name] if name in heights else fits[name]
        parts.append(part.translate((x, y, 0)))
    return compound(parts)


def export_scenes(root: Path, p: Params, base: cq.Workplane, heights: dict[str, cq.Workplane], fits: dict[str, cq.Workplane]) -> None:
    scene = root / "build" / "render-scenes"
    scene.mkdir(parents=True, exist_ok=True)
    all_blocks = {**heights, **fits}
    exporters.export(compound(list(all_blocks.values())), str(scene / "all-blocks.stl"), exportType="STL")
    exporters.export(base, str(scene / "base.stl"), exportType="STL")

    centers = socket_centers(p)
    assembled = [base]
    for block, (x, y) in zip((heights["low"], heights["medium"], heights["tall"], fits["standard_fit"]), centers):
        assembled.append(seated(block, p, x, y))
    exporters.export(compound(assembled), str(scene / "assembled.stl"), exportType="STL")

    sequence = [base]
    lifts = (0.0, 12.0, 28.0, 45.0)
    for block, (x, y), lift in zip((heights["low"], heights["medium"], heights["tall"], fits["standard_fit"]), centers, lifts):
        sequence.append(seated(block, p, x, y, lift))
    exporters.export(compound(sequence), str(scene / "push-pull.stl"), exportType="STL")


def write_metadata(root: Path, p: Params, base: cq.Workplane, heights: dict[str, cq.Workplane], fits: dict[str, cq.Workplane], plate: cq.Workplane) -> None:
    report = {
        "status": p.raw["status"],
        "units": "mm",
        "base_envelope_mm": [p.base["width"], p.base["length"], p.base["thickness"]],
        "module_footprint_mm": [p.module["footprint_width"], p.module["footprint_length"]],
        "module_heights_mm": {k: p.module[f"{k}_height"] for k in ("low", "medium", "tall")},
        "visible_module_gap_mm": p.base["socket_pitch"] - p.module["footprint_width"],
        "fit_parameters": p.fits,
        "part_volumes_mm3": {
            "base_2x2": round(volume(base), 3),
            **{f"block_{k}": round(volume(v), 3) for k, v in heights.items()},
            **{f"block_{k}": round(volume(v), 3) for k, v in fits.items()},
        },
        "plate_volume_mm3": round(volume(plate), 3),
        "notes": p.raw["notes"],
    }
    out = root / "build" / "dimensions.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", type=Path, required=True)
    args = parser.parse_args()
    root = args.project.resolve()
    p = load_params(root)
    base = build_base(p)
    heights = build_height_family(p)
    fits = build_fit_family(p)

    export(base, root / "step" / "base_2x2.step", root / "stl" / "base_2x2.stl")
    for name, part in heights.items():
        export(part, root / "step" / f"block_{name}.step", root / "stl" / f"block_{name}.stl")
    for name, part in fits.items():
        export(part, root / "step" / f"block_{name}.step", root / "stl" / f"block_{name}.stl")

    plate = print_plate(base, heights, fits)
    export(plate, root / "step" / "facet-totem-fit-test.step", root / "stl" / "facet-totem-fit-test.stl")
    export_scenes(root, p, base, heights, fits)
    write_metadata(root, p, base, heights, fits, plate)


if __name__ == "__main__":
    main()
