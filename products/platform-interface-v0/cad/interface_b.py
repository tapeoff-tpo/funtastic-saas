#!/usr/bin/env python3
"""Interface B: hook-and-slide with a terminal catch."""

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
    base = build_base_blank(p, "B")
    hook_x = cfg["hook_spacing"] / 2
    for x in (-hook_x, hook_x):
        hook = lofted_rect_lug(
            cfg["hook_neck_width"],
            cfg["hook_neck_length"],
            cfg["hook_cap_width"],
            cfg["hook_cap_length"],
            cfg["hook_neck_height"],
            cfg["hook_cap_height"],
            x,
            0.0,
            p.base_thickness,
        )
        base = base.union(hook)
    base = base.union(shallow_detent_bump(p, 0.0, cfg["terminal_y"], p.base_thickness))
    return base


def build_module(p: CommonParams, cfg: dict[str, Any]) -> cq.Workplane:
    module = build_module_blank(p, "B")
    hook_x = cfg["hook_spacing"] / 2
    floor = cfg["channel_floor"]
    cavity_height = p.module_thickness - floor - 0.8
    surface_height = p.module_thickness - (floor + cavity_height) + 0.1
    path_length = cfg["slide_distance"] + cfg["hook_cap_length"] + p.end_clearance
    path_center_y = cfg["slide_distance"] / 2
    cap_width = cfg["hook_cap_width"] + 2 * p.side_clearance
    cap_length = cfg["hook_cap_length"] + 2 * p.side_clearance
    neck_width = cfg["hook_neck_width"] + 2 * p.side_clearance

    for x in (-hook_x, hook_x):
        lower_cavity = box_at(
            cap_width,
            path_length,
            cavity_height,
            x,
            path_center_y,
            floor,
        )
        neck_path = box_at(
            neck_width,
            path_length,
            surface_height,
            x,
            path_center_y,
            floor + cavity_height,
        )
        entry = box_at(
            cap_width,
            cap_length,
            surface_height,
            x,
            cfg["slide_distance"],
            floor + cavity_height,
        )
        module = module.cut(lower_cavity).cut(neck_path).cut(entry)

    module = module.cut(
        shallow_detent_pocket(p, 0.0, cfg["terminal_y"], p.module_thickness)
    )
    return module


def design_notes() -> dict[str, list[str]]:
    return {
        "expected_advantages": [
            "Two separated hooks create a familiar lower-and-slide motion.",
            "Short travel limits friction compared with the continuous rail.",
            "Gravity can support the retained position in vertical use.",
        ],
        "expected_risks": [
            "The module may lift toward the entry during object removal.",
            "Users may lower the module without completing the terminal catch.",
            "Concentrated hook loads may create more local wear than Interface A.",
        ],
        "validate": [
            "Unintentional lift-out",
            "Partial engagement visibility",
            "Hook wear and cap damage",
            "One-hand release without moving the Base",
        ],
    }
