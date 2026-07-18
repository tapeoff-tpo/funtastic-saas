#!/usr/bin/env python3
"""Block Interface A: guided dovetail slide with terminal detent."""

from __future__ import annotations

from typing import Any

import cadquery as cq

from common_block_body import (
    BlockParams,
    build_base_blank,
    build_module_blank,
    detent_bump,
    detent_pocket,
    lofted_rect_lug,
    tapered_rect_channel,
)


def build_base(p: BlockParams, cfg: dict[str, Any]) -> cq.Workplane:
    base = build_base_blank(p, "A")
    for x in (-cfg["rail_spacing"] / 2, cfg["rail_spacing"] / 2):
        base = base.union(
            lofted_rect_lug(
                cfg["rail_neck_width"], cfg["rail_length"],
                cfg["rail_cap_width"], cfg["rail_length"],
                cfg["rail_neck_height"], cfg["rail_cap_height"],
                x, 0.0, p.base_thickness,
            )
        )
    return base.union(detent_bump(p, 0.0, cfg["detent_y"]))


def build_module(p: BlockParams, cfg: dict[str, Any]) -> cq.Workplane:
    module = build_module_blank(p, "A")
    path_length = cfg["channel_terminal_y"] - cfg["channel_entry_y"]
    path_y = (cfg["channel_terminal_y"] + cfg["channel_entry_y"]) / 2
    for x in (-cfg["rail_spacing"] / 2, cfg["rail_spacing"] / 2):
        module = module.cut(
            tapered_rect_channel(
                cfg["rail_neck_width"] + 2 * p.side_clearance,
                cfg["rail_cap_width"] + 2 * p.side_clearance,
                path_length,
                p.interface_depth,
                x,
                path_y,
                p.module_depth,
            )
        )
    # The Module is flipped around X for use, so its mating-face Y is mirrored.
    return module.cut(detent_pocket(p, 0.0, -cfg["detent_y"]))


def design_notes() -> dict[str, list[str]]:
    return {
        "expected_advantages": [
            "Continuous angled rails carry load while the shallow detent only confirms the endpoint.",
            "The long guided motion should be easiest to align with one hand.",
            "Angled channel walls replace the flat captured roof used by Phase 9.",
        ],
        "expected_risks": [
            "Long contact length can amplify PLA surface roughness and tolerance drift.",
            "Users may perceive the travel as slower than B or C.",
            "The rigid terminal bump may provide weak feedback or mark the mating face.",
        ],
        "validate": ["Insertion force", "endpoint feedback", "rattle", "wear after 100 cycles"],
    }
