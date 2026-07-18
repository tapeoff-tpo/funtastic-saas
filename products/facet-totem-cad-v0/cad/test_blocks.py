#!/usr/bin/env python3
"""Low, medium, tall, and fit-comparison Facet Totem blocks."""

from __future__ import annotations

import cadquery as cq

from common_facet_block import Params, facet_prism, fit_guide_width, hidden_label


def build_block(p: Params, height: float, fit_name: str, label: str) -> cq.Workplane:
    m, b, i, fit = p.module, p.base, p.interface, p.fits[fit_name]
    body = facet_prism(
        m["footprint_width"], m["footprint_length"], height,
        m["facet_size"], m["corner_radius"],
    ).translate((0, 0, i["insertion_depth"]))

    guide_width = fit_guide_width(p, fit_name)
    guide = facet_prism(
        guide_width, guide_width, i["insertion_depth"],
        max(2.0, b["socket_facet"] - fit["guide_side_clearance"]), 0.8,
    )

    # Lead-in chamfer is geometric, not a secondary motion: insertion remains straight.
    try:
        guide = guide.edges("<Z").chamfer(m["chamfer"])
    except Exception:
        pass

    block = body.union(guide)

    # Hidden opposing pockets receive the Base beads at final seating depth.
    pocket_depth = max(0.08, fit["pocket_depth"] + fit["retention_relief"])
    pocket_z = i["pocket_z_from_guide_bottom"]
    for sign in (-1, 1):
        x = sign * (guide_width / 2 - pocket_depth / 2 + 0.02)
        pocket = (
            cq.Workplane("XY")
            .box(pocket_depth + 0.08, i["pocket_length"], i["pocket_vertical"], centered=(True, True, False))
            .translate((x, 0, pocket_z))
        )
        block = block.cut(pocket)

    # A subtle lower-front relief gives fingers a consistent pull cue.
    grip = (
        cq.Workplane("XZ")
        .center(0, i["insertion_depth"] + 2.6)
        .ellipse(m["grip_relief_width"] / 2, m["grip_relief_depth"])
        .extrude(m["grip_relief_depth"] + 0.6, both=True)
        .translate((0, -m["footprint_length"] / 2, 0))
    )
    block = block.cut(grip)
    return hidden_label(block, label, m["mark_depth"])


def build_height_family(p: Params) -> dict[str, cq.Workplane]:
    m = p.module
    return {
        "low": build_block(p, m["low_height"], "standard", "LOW"),
        "medium": build_block(p, m["medium_height"], "standard", "MED"),
        "tall": build_block(p, m["tall_height"], "standard", "TALL"),
    }


def build_fit_family(p: Params) -> dict[str, cq.Workplane]:
    h = p.module["medium_height"]
    return {
        "light_fit": build_block(p, h, "light", "LIGHT"),
        "standard_fit": build_block(p, h, "standard", "STD"),
        "firm_fit": build_block(p, h, "firm", "FIRM"),
    }

