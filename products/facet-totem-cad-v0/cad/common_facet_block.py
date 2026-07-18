#!/usr/bin/env python3
"""Shared Facet Totem geometry and parameters."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import vtk  # noqa: F401 - load before OCP in the project runtime
import cadquery as cq


@dataclass(frozen=True)
class Params:
    raw: dict[str, Any]

    @property
    def base(self) -> dict[str, Any]: return self.raw["base"]
    @property
    def module(self) -> dict[str, Any]: return self.raw["module"]
    @property
    def interface(self) -> dict[str, Any]: return self.raw["interface"]
    @property
    def fits(self) -> dict[str, Any]: return self.raw["fits"]


def load_params(root: Path) -> Params:
    payload = json.loads((root / "parameters" / "parameters.json").read_text(encoding="utf-8"))
    return Params(payload)


def facet_points(width: float, length: float, facet: float) -> list[tuple[float, float]]:
    """Asymmetric five-sided footprint; the clipped +X/+Y corner is the orientation cue."""
    x, y = width / 2, length / 2
    return [(-x, -y), (x, -y), (x, y - facet), (x - facet, y), (-x, y)]


def facet_prism(width: float, length: float, height: float, facet: float, radius: float = 0.0) -> cq.Workplane:
    part = cq.Workplane("XY").polyline(facet_points(width, length, facet)).close().extrude(height)
    if radius > 0:
        try:
            part = part.edges("|Z").fillet(radius)
        except Exception:
            pass
    return part


def rounded_plate(width: float, length: float, height: float, radius: float) -> cq.Workplane:
    return (
        cq.Workplane("XY")
        .box(width, length, height, centered=(True, True, False))
        .edges("|Z")
        .fillet(radius)
    )


def socket_centers(p: Params) -> list[tuple[float, float]]:
    pitch = p.base["socket_pitch"]
    return [(-pitch / 2, pitch / 2), (pitch / 2, pitch / 2), (-pitch / 2, -pitch / 2), (pitch / 2, -pitch / 2)]


def fit_guide_width(p: Params, fit_name: str) -> float:
    clearance = p.fits[fit_name]["guide_side_clearance"]
    return p.base["socket_width"] - 2 * clearance


def hidden_label(part: cq.Workplane, label: str, depth: float) -> cq.Workplane:
    """Cut a small identifier into the downward-facing hidden surface."""
    return part.faces("<Z").workplane(invert=True).text(label, 4.0, -depth, cut=True, combine=True)


def volume(part: cq.Workplane) -> float:
    return sum(s.Volume() for s in part.solids().vals())


def compound(parts: list[cq.Workplane]) -> cq.Workplane:
    vals = []
    for part in parts:
        vals.extend(part.vals())
    return cq.Workplane(obj=cq.Compound.makeCompound(vals))

