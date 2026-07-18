#!/usr/bin/env python3
"""Common 2x2 Base for the Facet Totem fit prototype."""

from __future__ import annotations

import cadquery as cq

from common_facet_block import Params, facet_prism, rounded_plate, socket_centers


def build_base(p: Params) -> cq.Workplane:
    b, i = p.base, p.interface
    base = rounded_plate(b["width"], b["length"], b["thickness"], b["corner_radius"])

    # Shallow surrounding reveals make the plate read as a designed 2x2 field.
    for x, y in socket_centers(p):
        reveal = facet_prism(
            b["top_reveal_width"], b["top_reveal_width"], b["top_reveal_depth"],
            b["socket_facet"] + 1.0, b["socket_edge_radius"],
        ).translate((x, y, b["thickness"] - b["top_reveal_depth"]))
        base = base.cut(reveal)

        socket = facet_prism(
            b["socket_width"], b["socket_length"], b["socket_depth"] + 0.05,
            b["socket_facet"], b["socket_edge_radius"],
        ).translate((x, y, b["thickness"] - b["socket_depth"]))
        base = base.cut(socket)

        # Two shallow side beads provide seating feedback. Broad socket walls carry load.
        bead_x = b["socket_width"] / 2 - i["retention_bead_height"] / 2
        bead_z = b["thickness"] - b["socket_depth"] + i["retention_z_from_base"]
        for sign in (-1, 1):
            bead = (
                cq.Workplane("XY")
                .box(i["retention_bead_height"], i["retention_bead_length"], i["retention_bead_vertical"], centered=(True, True, False))
                .translate((x + sign * bead_x, y, bead_z))
            )
            try:
                bead = bead.edges("|Y").fillet(min(0.18, i["retention_bead_height"] * 0.7))
            except Exception:
                pass
            base = base.union(bead)
    return base

