#!/usr/bin/env python3
"""Interface C: three-point short-turn bayonet with terminal throats."""

from __future__ import annotations

import math
from typing import Any

import cadquery as cq

from common_test_body import (
    CommonParams,
    arc_centers,
    build_base_blank,
    build_module_blank,
    cylinder_at,
    lofted_round_lug,
)


def build_base(p: CommonParams, cfg: dict[str, Any]) -> cq.Workplane:
    base = build_base_blank(p, "C")
    for index in range(int(cfg["lug_count"])):
        angle = 360.0 * index / cfg["lug_count"]
        x = cfg["lug_radius"] * math.cos(math.radians(angle))
        y = cfg["lug_radius"] * math.sin(math.radians(angle))
        lug = lofted_round_lug(
            cfg["lug_neck_diameter"] / 2,
            cfg["lug_cap_diameter"] / 2,
            cfg["lug_neck_height"],
            cfg["lug_cap_height"],
            x,
            y,
            p.base_thickness,
        )
        base = base.union(lug)
    return base


def build_module(p: CommonParams, cfg: dict[str, Any]) -> cq.Workplane:
    module = build_module_blank(p, "C")
    floor = cfg["channel_floor"]
    cavity_height = p.module_thickness - floor - 0.8
    surface_height = p.module_thickness - (floor + cavity_height) + 0.1
    cap_radius = cfg["lug_cap_diameter"] / 2 + p.side_clearance
    neck_radius = cfg["lug_neck_diameter"] / 2 + p.side_clearance
    samples = int(cfg["track_samples"])

    for index in range(int(cfg["lug_count"])):
        start = 360.0 * index / cfg["lug_count"]
        end = start + cfg["rotation_angle_deg"]
        centers = arc_centers(cfg["lug_radius"], start, end, samples)

        for x, y in centers:
            module = module.cut(cylinder_at(cap_radius, cavity_height, x, y, floor))

        for point_index, (x, y) in enumerate(centers):
            reduction = 0.0
            if point_index >= samples - 2:
                reduction = cfg["terminal_throat_reduction"]
            radius = neck_radius - reduction
            module = module.cut(
                cylinder_at(radius, surface_height, x, y, floor + cavity_height)
            )

        entry_x, entry_y = centers[0]
        module = module.cut(
            cylinder_at(cap_radius, surface_height, entry_x, entry_y, floor + cavity_height)
        )
    return module


def design_notes() -> dict[str, list[str]]:
    return {
        "expected_advantages": [
            "Insert-and-turn creates the clearest ritual and orientation change of the three variants.",
            "Three lugs distribute moment around the module center.",
            "The terminal throat can provide confirmation without a separate part.",
        ],
        "expected_risks": [
            "Arc tracks are more tolerance-sensitive and can bind from surface roughness.",
            "Users may not infer rotation direction without a visible cue.",
            "The shallow roofs over the sub-surface tracks require close slicer inspection.",
        ],
        "validate": [
            "First-use rotation comprehension",
            "Terminal throat click and wear",
            "Partial rotation retention",
            "Fit consistency across PLA colors and spools",
        ],
    }
