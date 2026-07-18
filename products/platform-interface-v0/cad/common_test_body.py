#!/usr/bin/env python3
"""Common geometry and parameter helpers for the V0 interface comparison."""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import vtk  # noqa: F401 - CadQuery/OCP needs VTK loaded first on this runtime.
import cadquery as cq


@dataclass(frozen=True)
class CommonParams:
    base_width: float
    base_height: float
    base_thickness: float
    module_width: float
    module_height: float
    module_thickness: float
    corner_radius: float
    interface_width: float
    interface_length: float
    interface_depth: float
    insertion_clearance: float
    side_clearance: float
    end_clearance: float
    detent_height: float
    detent_length: float
    catch_depth: float
    contact_length: float
    module_projection_length: float
    fillet: float
    minimum_wall: float
    load_hole_diameter: float
    load_hole_center_y: float
    wear_mark_depth: float
    equalizer_slot_width: float


def load_parameters(project_root: Path) -> tuple[CommonParams, dict[str, Any]]:
    path = project_root / "parameters" / "parameters.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    return CommonParams(**payload["common"]), payload


def rounded_plate(width: float, height: float, thickness: float, radius: float) -> cq.Workplane:
    return (
        cq.Workplane("XY")
        .box(width, height, thickness, centered=(True, True, False))
        .edges("|Z")
        .fillet(radius)
    )


def engrave_label(part: cq.Workplane, label: str, thickness: float) -> cq.Workplane:
    return (
        part.faces(">Z")
        .workplane()
        .center(-24.0, -27.0)
        .text(label, 8.0, -0.45, cut=True, combine=True)
    )


def add_witness_marks(part: cq.Workplane, p: CommonParams, thickness: float) -> cq.Workplane:
    depth = p.wear_mark_depth
    line_y = p.interface_length / 2 + 2.0
    vertical = (
        cq.Workplane("XY")
        .box(0.6, 8.0, depth + 0.05, centered=(True, True, False))
        .translate((0, line_y, thickness - depth))
    )
    horizontal = (
        cq.Workplane("XY")
        .box(8.0, 0.6, depth + 0.05, centered=(True, True, False))
        .translate((0, line_y, thickness - depth))
    )
    return part.cut(vertical).cut(horizontal)


def build_base_blank(p: CommonParams, label: str) -> cq.Workplane:
    base = rounded_plate(p.base_width, p.base_height, p.base_thickness, p.corner_radius)
    base = engrave_label(base, label, p.base_thickness)
    return add_witness_marks(base, p, p.base_thickness)


def build_module_blank(p: CommonParams, label: str) -> cq.Workplane:
    module = rounded_plate(p.module_width, p.module_height, p.module_thickness, p.corner_radius)
    module = (
        module.faces(">Z")
        .workplane()
        .center(0, p.load_hole_center_y)
        .hole(p.load_hole_diameter)
    )
    module = engrave_label(module, label, p.module_thickness)
    return add_witness_marks(module, p, p.module_thickness)


def box_at(
    width: float,
    height: float,
    depth: float,
    x: float,
    y: float,
    z: float,
) -> cq.Workplane:
    return (
        cq.Workplane("XY")
        .box(width, height, depth, centered=(True, True, False))
        .translate((x, y, z))
    )


def cylinder_at(radius: float, height: float, x: float, y: float, z: float) -> cq.Workplane:
    return cq.Workplane("XY").circle(radius).extrude(height).translate((x, y, z))


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
    taper = (
        cq.Workplane("XY")
        .workplane(offset=z + neck_height)
        .center(x, y)
        .rect(neck_width, neck_length)
        .workplane(offset=cap_height)
        .rect(cap_width, cap_length)
        .loft(combine=True)
    )
    return neck.union(taper)


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
    taper = (
        cq.Workplane("XY")
        .workplane(offset=z + neck_height)
        .center(x, y)
        .circle(neck_radius)
        .workplane(offset=cap_height)
        .circle(cap_radius)
        .loft(combine=True)
    )
    return neck.union(taper)


def shallow_detent_bump(p: CommonParams, x: float, y: float, z: float) -> cq.Workplane:
    radius = p.detent_length / 2
    bump = cylinder_at(radius, p.detent_height, x, y, z)
    try:
        return bump.edges(">Z").fillet(min(0.25, p.detent_height * 0.6))
    except Exception:
        return bump


def shallow_detent_pocket(p: CommonParams, x: float, y: float, top_z: float) -> cq.Workplane:
    return cylinder_at(
        p.detent_length / 2 + p.side_clearance,
        p.catch_depth,
        x,
        y,
        top_z - p.catch_depth,
    )


def arc_centers(radius: float, start_deg: float, end_deg: float, samples: int) -> list[tuple[float, float]]:
    if samples < 2:
        raise ValueError("track_samples must be at least 2")
    return [
        (
            radius * math.cos(math.radians(start_deg + (end_deg - start_deg) * i / (samples - 1))),
            radius * math.sin(math.radians(start_deg + (end_deg - start_deg) * i / (samples - 1))),
        )
        for i in range(samples)
    ]


def shape_volume(part: cq.Workplane) -> float:
    return sum(solid.Volume() for solid in part.solids().vals())


def equalize_base_volume(
    base: cq.Workplane,
    volume_to_remove: float,
    p: CommonParams,
) -> cq.Workplane:
    """Remove neutral material from the lower test-only zone to equalize pair mass."""
    if volume_to_remove <= 0.05:
        return base
    slot_length = volume_to_remove / (p.equalizer_slot_width * p.base_thickness)
    if slot_length > p.base_width - 16.0:
        raise ValueError(f"Equalizer slot is too long: {slot_length:.2f} mm")
    cutter = box_at(
        slot_length,
        p.equalizer_slot_width,
        p.base_thickness + 0.2,
        0,
        -p.base_height / 2 + 8.0,
        -0.1,
    )
    return base.cut(cutter)


def compound(parts: list[cq.Workplane]) -> cq.Workplane:
    shapes = []
    for part in parts:
        shapes.extend(part.vals())
    return cq.Workplane(obj=cq.Compound.makeCompound(shapes))
