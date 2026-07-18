#!/usr/bin/env python3
"""Compose concept/CAD and dimension review sheets from real renders."""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
OUT = ROOT / "renders"
FONT = ImageFont.load_default(size=28)
SMALL = ImageFont.load_default(size=20)


def contain(path: Path, size: tuple[int, int]) -> Image.Image:
    im = Image.open(path).convert("RGB")
    im.thumbnail(size, Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", size, "#f3f1ec")
    canvas.paste(im, ((size[0] - im.width) // 2, (size[1] - im.height) // 2))
    return canvas


def concept_vs_cad() -> None:
    concept = contain(REPO / "products/platform-block-direction/renders/direction-b-overview.png", (900, 900))
    cad = contain(OUT / "assembled-2x2.png", (900, 900))
    sheet = Image.new("RGB", (1800, 980), "#f3f1ec")
    sheet.paste(concept, (0, 80)); sheet.paste(cad, (900, 80))
    draw = ImageDraw.Draw(sheet)
    draw.text((450, 30), "PHASE 9.2 VISUAL INTENT", fill="#202225", font=FONT, anchor="mm")
    draw.text((1350, 30), "PHASE 9.3 ACTUAL CAD", fill="#202225", font=FONT, anchor="mm")
    draw.line((900, 0, 900, 980), fill="#b6b1a8", width=3)
    sheet.save(OUT / "phase9-2-vs-cad.png")


def dimensions() -> None:
    top = contain(OUT / "top.png", (900, 760))
    front = contain(OUT / "front.png", (900, 760))
    sheet = Image.new("RGB", (1800, 920), "#f3f1ec")
    sheet.paste(top, (0, 120)); sheet.paste(front, (900, 120))
    draw = ImageDraw.Draw(sheet)
    draw.text((450, 48), "TOP: BASE 118 x 118 mm / PITCH 54 mm", fill="#202225", font=FONT, anchor="mm")
    draw.text((1350, 48), "FRONT: MODULE 46 x 46 mm FOOTPRINT", fill="#202225", font=FONT, anchor="mm")
    draw.text((1350, 88), "VISIBLE HEIGHTS 22 / 38 / 58 mm", fill="#202225", font=SMALL, anchor="mm")
    draw.text((450, 88), "NOMINAL MODULE GAP 8 mm", fill="#202225", font=SMALL, anchor="mm")
    draw.line((900, 0, 900, 920), fill="#b6b1a8", width=3)
    sheet.save(OUT / "dimension-comparison.png")


concept_vs_cad()
dimensions()
