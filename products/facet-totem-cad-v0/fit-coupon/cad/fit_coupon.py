#!/usr/bin/env python3
"""Generate independent Light, Standard, and Firm Facet Totem fit coupons."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import vtk  # noqa: F401
import cadquery as cq
from cadquery import exporters


HERE = Path(__file__).resolve()
PARENT_PROJECT = HERE.parents[2]
sys.path.insert(0, str(PARENT_PROJECT / "cad"))

from common_facet_block import compound, facet_prism, hidden_label, load_params, rounded_plate, volume  # noqa: E402
from test_blocks import build_block  # noqa: E402


def load_coupon(root: Path) -> dict:
    return json.loads((root / "parameters" / "fit-coupon-parameters.json").read_text(encoding="utf-8"))


def build_socket_coupon(p, c: dict, label: str | None = None) -> cq.Workplane:
    """Use the exact parent socket/reveal/bead geometry with only outer flange reduced."""
    b, i = p.base, p.interface
    outer = c["coupon"]
    coupon = rounded_plate(
        outer["socket_outer_width"], outer["socket_outer_length"],
        outer["socket_thickness"], outer["socket_outer_radius"],
    )
    reveal = facet_prism(
        b["top_reveal_width"], b["top_reveal_width"], b["top_reveal_depth"],
        b["socket_facet"] + 1.0, b["socket_edge_radius"],
    ).translate((0, 0, b["thickness"] - b["top_reveal_depth"]))
    coupon = coupon.cut(reveal)
    socket = facet_prism(
        b["socket_width"], b["socket_length"], b["socket_depth"] + 0.05,
        b["socket_facet"], b["socket_edge_radius"],
    ).translate((0, 0, b["thickness"] - b["socket_depth"]))
    coupon = coupon.cut(socket)

    bead_x = b["socket_width"] / 2 - i["retention_bead_height"] / 2
    bead_z = b["thickness"] - b["socket_depth"] + i["retention_z_from_base"]
    for sign in (-1, 1):
        bead = (
            cq.Workplane("XY")
            .box(i["retention_bead_height"], i["retention_bead_length"], i["retention_bead_vertical"], centered=(True, True, False))
            .translate((sign * bead_x, 0, bead_z))
        )
        try:
            bead = bead.edges("|Y").fillet(min(0.18, i["retention_bead_height"] * 0.7))
        except Exception:
            pass
        coupon = coupon.union(bead)
    return hidden_label(coupon, label, p.module["mark_depth"]) if label else coupon


def export(part: cq.Workplane, step: Path, stl: Path) -> None:
    step.parent.mkdir(parents=True, exist_ok=True); stl.parent.mkdir(parents=True, exist_ok=True)
    exporters.export(part, str(step), exportType="STEP")
    exporters.export(part, str(stl), exportType="STL", tolerance=0.035, angularTolerance=0.08)


def build_coupon_plug(parent, height: float, fit: str, label: str) -> cq.Workplane:
    """Keep the parent interface intact; hollow only the nonfunctional grip volume."""
    plug = build_block(parent, height, fit, label)
    m, i = parent.module, parent.interface
    inner_width = m["footprint_width"] - 2 * m["shell_thickness"]
    cavity_height = height - m["bottom_thickness"] + 0.1
    cavity = facet_prism(
        inner_width, inner_width, cavity_height,
        max(2.0, m["facet_size"] - m["shell_thickness"]), 1.4,
    ).translate((0, 0, i["insertion_depth"] + m["bottom_thickness"]))
    return plug.cut(cavity)


def make_parts(parent, coupon: dict) -> dict[str, cq.Workplane]:
    height = coupon["coupon"]["plug_visible_grip_height"]
    parts = {}
    for fit, label in (("light", "L"), ("standard", "S"), ("firm", "F")):
        parts[f"{fit}_socket"] = build_socket_coupon(parent, coupon, label)
        parts[f"{fit}_plug"] = build_coupon_plug(parent, height, fit, label)
    return parts


def build_plate(parts: dict[str, cq.Workplane], c: dict) -> cq.Workplane:
    pitch_x, pitch_y = c["coupon"]["plate_column_pitch"], c["coupon"]["plate_row_pitch"]
    placed = []
    for fit, x in (("light", -pitch_x), ("standard", 0), ("firm", pitch_x)):
        placed.append(parts[f"{fit}_socket"].translate((x, pitch_y / 2, 0)))
        placed.append(parts[f"{fit}_plug"].translate((x, -pitch_y / 2, 0)))
    return compound(placed)


def write_metadata(root: Path, parent, coupon: dict, parts: dict[str, cq.Workplane], plate: cq.Workplane) -> None:
    data = {
        "status": coupon["status"],
        "source_parent_parameters": "../../parameters/parameters.json",
        "coupon_parameters": coupon["coupon"],
        "fit_values": coupon["fit_values"],
        "part_volumes_mm3": {k: round(volume(v), 3) for k, v in parts.items()},
        "plate_volume_mm3": round(volume(plate), 3),
        "unchanged_interface": coupon["inherited_unchanged"],
        "notes": [
            "Only visible plug height and nonfunctional socket flange area were reduced.",
            "Functional socket, guide, stop, bead, pocket, print direction, and fit values are inherited unchanged.",
        ],
    }
    out = root / "build" / "dimensions.json"; out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(); parser.add_argument("--project", type=Path, required=True)
    root = parser.parse_args().project.resolve()
    parent = load_params(PARENT_PROJECT); coupon = load_coupon(root); parts = make_parts(parent, coupon)
    for name, part in parts.items(): export(part, root / "step" / f"{name}.step", root / "stl" / f"{name}.stl")
    plate = build_plate(parts, coupon)
    exporters.export(plate, str(root / "stl" / "fit-coupon-plate.stl"), exportType="STL", tolerance=0.035, angularTolerance=0.08)
    write_metadata(root, parent, coupon, parts, plate)


if __name__ == "__main__": main()
