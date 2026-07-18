#!/usr/bin/env python3
"""Common block body and geometry helpers for Phase 9.1."""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import vtk  # noqa: F401 - required before CadQuery/OCP in this runtime
import cadquery as cq


@dataclass(frozen=True)
class BlockParams:
    base_width: float
    base_height: float
    base_thickness: float
    base_corner_radius: float
    module_width: float
    module_height: float
    module_depth: float
    module_corner_radius: float
    interface_width: float
    interface_length: float
    interface_depth: float
    insertion_clearance: float
    side_clearance: float
    end_clearance: float
    detent_height: float
    detent_diameter: float
    detent_pocket_depth: float
    shell_wall: float
    fillet: float
    module_projection: float
    grid_pitch: float
    label_depth: float
    wear_mark_depth: float


def load_parameters(project_root: Path) -> tuple[BlockParams, dict[str, Any]]:
    payload = json.loads(
        (project_root / "parameters" / "parameters.json").read_text(encoding="utf-8")
    )
    return BlockParams(**payload["common"]), payload


def rounded_block(width: float, height: float, depth: float, radius: float) -> cq.Workplane:
    return (
        cq.Workplane("XY")
        .box(width, height, depth, centered=(True, True, False))
        .edges("|Z")
        .fillet(radius)
    )


def box_at(width: float, length: float, depth: float, x: float, y: float, z: float) -> cq.Workplane:
    return (
        cq.Workplane("XY")
        .box(width, length, depth, centered=(True, True, False))
        .translate((x, y, z))
    )


def cylinder_at(radius: float, depth: float, x: float, y: float, z: float) -> cq.Workplane:
    return cq.Workplane("XY").circle(radius).extrude(depth).translate((x, y, z))


def build_base_blank(p: BlockParams, label: str) -> cq.Workplane:
    base = rounded_block(p.base_width, p.base_height, p.base_thickness, p.base_corner_radius)
    return (
        base.faces(">Z")
        .workplane()
        .center(-16.0, -16.0)
        .text(label, 4.2, -p.label_depth, cut=True, combine=True)
    )


def build_module_blank(p: BlockParams, label: str) -> cq.Workplane:
    module = rounded_block(
        p.module_width, p.module_height, p.module_depth, p.module_corner_radius
    )
    module = (
        module.faces(">Z")
        .workplane()
        .center(-13.0, -13.0)
        .text(label, 4.2, -p.label_depth, cut=True, combine=True)
    )
    # Small witness marks sit on the hidden mating face and reveal wear drift.
    line_z = p.module_depth - p.wear_mark_depth
    vertical = box_at(0.5, 5.0, p.wear_mark_depth + 0.05, 0, 13.5, line_z)
    horizontal = box_at(5.0, 0.5, p.wear_mark_depth + 0.05, 0, 13.5, line_z)
    return module.cut(vertical).cut(horizontal)


def lofted_rect_lug(
    neck_width: float,
    neck_length: float,
    cap_width: float,
    cap_length: float,
    neck_height: float,
    cap_height: float,
    x: float,
    y: float,
    z: float,
) -> cq.Workplane:
    neck = box_at(neck_width, neck_length, neck_height, x, y, z)
    cap = (
        cq.Workplane("XY")
        .workplane(offset=z + neck_height)
        .center(x, y)
        .rect(neck_width, neck_length)
        .workplane(offset=cap_height)
        .rect(cap_width, cap_length)
        .loft(combine=True)
    )
    return neck.union(cap)


def lofted_round_lug(
    neck_radius: float,
    cap_radius: float,
    neck_height: float,
    cap_height: float,
    x: float,
    y: float,
    z: float,
) -> cq.Workplane:
    neck = cylinder_at(neck_radius, neck_height, x, y, z)
    cap = (
        cq.Workplane("XY")
        .workplane(offset=z + neck_height)
        .center(x, y)
        .circle(neck_radius)
        .workplane(offset=cap_height)
        .circle(cap_radius)
        .loft(combine=True)
    )
    return neck.union(cap)


def tapered_rect_channel(
    neck_width: float,
    cap_width: float,
    length: float,
    depth: float,
    x: float,
    y: float,
    top_z: float,
) -> cq.Workplane:
    return (
        cq.Workplane("XY")
        .workplane(offset=top_z - depth)
        .center(x, y)
        .rect(cap_width, length)
        .workplane(offset=depth + 0.1)
        .rect(neck_width, length)
        .loft(combine=True)
    )


def tapered_round_channel(
    neck_radius: float,
    cap_radius: float,
    depth: float,
    x: float,
    y: float,
    top_z: float,
) -> cq.Workplane:
    return (
        cq.Workplane("XY")
        .workplane(offset=top_z - depth)
        .center(x, y)
        .circle(cap_radius)
        .workplane(offset=depth + 0.1)
        .circle(neck_radius)
        .loft(combine=True)
    )


def detent_bump(p: BlockParams, x: float, y: float) -> cq.Workplane:
    bump = cylinder_at(p.detent_diameter / 2, p.detent_height, x, y, p.base_thickness)
    try:
        return bump.edges(">Z").fillet(min(0.2, p.detent_height * 0.55))
    except Exception:
        return bump


def detent_pocket(p: BlockParams, x: float, y: float) -> cq.Workplane:
    return cylinder_at(
        p.detent_diameter / 2 + p.side_clearance,
        p.detent_pocket_depth,
        x,
        y,
        p.module_depth - p.detent_pocket_depth,
    )


def arc_centers(radius: float, start_deg: float, end_deg: float, samples: int) -> list[tuple[float, float]]:
    return [
        (
            radius * math.cos(math.radians(start_deg + (end_deg - start_deg) * i / (samples - 1))),
            radius * math.sin(math.radians(start_deg + (end_deg - start_deg) * i / (samples - 1))),
        )
        for i in range(samples)
    ]


def shape_volume(part: cq.Workplane) -> float:
    return sum(solid.Volume() for solid in part.solids().vals())


def compound(parts: list[cq.Workplane]) -> cq.Workplane:
    shapes = []
    for part in parts:
        shapes.extend(part.vals())
    return cq.Workplane(obj=cq.Compound.makeCompound(shapes))


def assembled_module(module: cq.Workplane, p: BlockParams, x: float, y: float, lift: float = 0.0) -> cq.Workplane:
    return (
        module.rotate((0, 0, 0), (1, 0, 0), 180)
        .translate((x, y, p.base_thickness + p.module_depth + lift))
    )
