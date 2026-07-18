#!/usr/bin/env python3
"""Block Interface C: three-point short-turn bayonet with terminal throats."""

from __future__ import annotations

import math
from typing import Any

import cadquery as cq

from common_block_body import (
    BlockParams,
    arc_centers,
    build_base_blank,
    build_module_blank,
    lofted_round_lug,
    tapered_round_channel,
)


def build_base(p: BlockParams, cfg: dict[str, Any]) -> cq.Workplane:
    base = build_base_blank(p, "C")
    for index in range(int(cfg["lug_count"])):
        angle = 360.0 * index / cfg["lug_count"]
        x = cfg["lug_radius"] * math.cos(math.radians(angle))
        y = cfg["lug_radius"] * math.sin(math.radians(angle))
        base = base.union(
            lofted_round_lug(
                cfg["lug_neck_diameter"] / 2,
                cfg["lug_cap_diameter"] / 2,
                cfg["lug_neck_height"], cfg["lug_cap_height"],
                x, y, p.base_thickness,
            )
        )
    return base


def build_module(p: BlockParams, cfg: dict[str, Any]) -> cq.Workplane:
    module = build_module_blank(p, "C")
    samples = int(cfg["track_samples"])
    cap_radius = cfg["lug_cap_diameter"] / 2 + p.side_clearance
    neck_radius = cfg["lug_neck_diameter"] / 2 + p.side_clearance
    for index in range(int(cfg["lug_count"])):
        start = 360.0 * index / cfg["lug_count"]
        end = start + cfg["rotation_angle_deg"]
        centers = arc_centers(cfg["lug_radius"], start, end, samples)
        for point_index, (x, y) in enumerate(centers):
            reduction = cfg["terminal_throat_reduction"] if point_index >= samples - 2 else 0.0
            module = module.cut(
                tapered_round_channel(
                    neck_radius - reduction,
                    cap_radius,
                    p.interface_depth,
                    x,
                    y,
                    p.module_depth,
                )
            )
        entry_x, entry_y = centers[0]
        module = module.cut(
            tapered_round_channel(
                cap_radius,
                cap_radius,
                p.interface_depth,
                entry_x,
                entry_y,
                p.module_depth,
            )
        )
    return module


def design_notes() -> dict[str, list[str]]:
    return {
        "expected_advantages": [
            "A short rotation creates the clearest assembly ritual of the three variants.",
            "Three lugs distribute moment around the Module center.",
            "The assembled interface is visually hidden inside the block boundary.",
        ],
        "expected_risks": [
            "Arc tracks are the most tolerance-sensitive geometry.",
            "Rotation direction may not be obvious without a cue.",
            "Terminal throat friction may change quickly with PLA wear.",
        ],
        "validate": ["rotation comprehension", "binding", "terminal feedback", "wear"],
    }
