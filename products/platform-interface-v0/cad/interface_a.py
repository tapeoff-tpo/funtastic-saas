#!/usr/bin/env python3
"""Interface A: guided slide with a terminal shallow detent."""

from __future__ import annotations

from typing import Any

import cadquery as cq

from common_test_body import (
    CommonParams,
    box_at,
    build_base_blank,
    build_module_blank,
    lofted_rect_lug,
    shallow_detent_bump,
    shallow_detent_pocket,
)


def build_base(p: CommonParams, cfg: dict[str, Any]) -> cq.Workplane:
    base = build_base_blank(p, "A")
    rail_x = cfg["rail_spacing"] / 2
    rail_y = 0.0
    for x in (-rail_x, rail_x):
        rail = lofted_rect_lug(
            cfg["rail_neck_width"],
            cfg["rail_length"],
            cfg["rail_cap_width"],
            cfg["rail_length"],
            cfg["rail_neck_height"],
            cfg["rail_cap_height"],
            x,
            rail_y,
            p.base_thickness,
        )
        base = base.union(rail)
    base = base.union(shallow_detent_bump(p, 0.0, cfg["terminal_y"], p.base_thickness))
    return base


def build_module(p: CommonParams, cfg: dict[str, Any]) -> cq.Workplane:
    module = build_module_blank(p, "A")
    rail_x = cfg["rail_spacing"] / 2
    floor = cfg["channel_floor"]
    cavity_height = p.module_thickness - floor - 0.8
    surface_height = p.module_thickness - (floor + cavity_height) + 0.1
    channel_min_y = -p.module_height / 2 - 0.1
    channel_max_y = cfg["terminal_y"] + p.end_clearance
    channel_length = channel_max_y - channel_min_y
    channel_center_y = (channel_min_y + channel_max_y) / 2
    cap_clear = cfg["rail_cap_width"] + 2 * p.side_clearance
    neck_clear = cfg["rail_neck_width"] + 2 * p.side_clearance

    for x in (-rail_x, rail_x):
        lower_cavity = box_at(
            cap_clear,
            channel_length,
            cavity_height,
            x,
            channel_center_y,
            floor,
        )
        surface_slot = box_at(
            neck_clear,
            channel_length,
            surface_height,
            x,
            channel_center_y,
            floor + cavity_height,
        )
        entry = box_at(
            cap_clear,
            cfg["entry_length"],
            surface_height,
            x,
            channel_min_y + cfg["entry_length"] / 2,
            floor + cavity_height,
        )
        module = module.cut(lower_cavity).cut(surface_slot).cut(entry)

    module = module.cut(
        shallow_detent_pocket(p, 0.0, cfg["terminal_y"], p.module_thickness)
    )
    return module


def design_notes() -> dict[str, list[str]]:
    return {
        "expected_advantages": [
            "Continuous rails carry shear and moment while the detent provides only end confirmation.",
            "Long guidance should reduce wrong-angle insertion and rattle.",
            "The module body can grow without changing the rail grammar.",
        ],
        "expected_risks": [
            "Long sliding contact may magnify surface roughness and spool-to-spool tolerance variation.",
            "The 1 mm-scale channel lips require slicer inspection for short bridges.",
            "A rigid shallow detent may feel weak or require excessive local deflection.",
        ],
        "validate": [
            "Insertion force consistency",
            "Terminal click and visual confirmation",
            "Rattle and wear debris after 100 cycles",
            "Base movement during removal",
        ],
    }
