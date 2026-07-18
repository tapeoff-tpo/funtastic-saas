#!/usr/bin/env python3
"""Block Interface B: two hook lugs with a short guided slide and catch."""

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
    base = build_base_blank(p, "B")
    for x in (-cfg["hook_spacing"] / 2, cfg["hook_spacing"] / 2):
        base = base.union(
            lofted_rect_lug(
                cfg["hook_neck_width"], cfg["hook_neck_length"],
                cfg["hook_cap_width"], cfg["hook_cap_length"],
                cfg["hook_neck_height"], cfg["hook_cap_height"],
                x, cfg["terminal_y"], p.base_thickness,
            )
        )
    return base.union(detent_bump(p, 0.0, cfg["detent_y"]))


def build_module(p: BlockParams, cfg: dict[str, Any]) -> cq.Workplane:
    module = build_module_blank(p, "B")
    path_length = cfg["slide_distance"] + cfg["hook_cap_length"] + p.end_clearance
    path_y = cfg["entry_y"] / 2
    for x in (-cfg["hook_spacing"] / 2, cfg["hook_spacing"] / 2):
        module = module.cut(
            tapered_rect_channel(
                cfg["hook_neck_width"] + 2 * p.side_clearance,
                cfg["hook_cap_width"] + 2 * p.side_clearance,
                path_length,
                p.interface_depth,
                x,
                path_y,
                p.module_depth,
            )
        )
        # Enlarged entry communicates the initial lower-and-hook action.
        module = module.cut(
            tapered_rect_channel(
                cfg["hook_cap_width"] + 2 * p.side_clearance,
                cfg["hook_cap_width"] + 2 * p.side_clearance,
                cfg["hook_cap_length"] + 2 * p.side_clearance,
                p.interface_depth,
                x,
                cfg["entry_y"],
                p.module_depth,
            )
        )
    # The Module is flipped around X for use, so its mating-face Y is mirrored.
    return module.cut(detent_pocket(p, 0.0, -cfg["detent_y"]))


def design_notes() -> dict[str, list[str]]:
    return {
        "expected_advantages": [
            "Two short hook points create a quick lower-and-slide gesture.",
            "Short travel reduces friction compared with A.",
            "Gravity supports the final position on a vertical Base.",
        ],
        "expected_risks": [
            "A user can stop in a partially engaged state.",
            "The Module may lift toward the entry during removal of an accessory.",
            "Loads are concentrated at two local hooks.",
        ],
        "validate": ["lift-out", "partial engagement", "local wear", "one-hand removal"],
    }
