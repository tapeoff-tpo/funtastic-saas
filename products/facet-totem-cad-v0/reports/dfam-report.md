# DFAM Report

## Process baseline

- Printer: Bambu Lab P2S
- Material: Generic PLA
- Nozzle: 0.4mm
- Layer: 0.20mm Standard
- Wall loops: 2
- Infill: 15%
- Support: disabled
- Brim: disabled

## Positive findings

- Every part has a broad planar print surface.
- The insertion direction is parallel to Z and requires no support-generated mating face.
- No living hinge, deep cantilever snap, screw, magnet, or metal insert is used.
- The asymmetric footprint is produced with continuous walls and no circular stud array.
- Base and all block STLs are watertight volumes and STEP files contain one solid each.
- The 118×118mm Base and complete 229×150mm plate fit the P2S volume.

## Risks

| Risk | Level | Reason / physical check |
| --- | --- | --- |
| Base warp | Medium | 118mm square footprint; confirm corners remain flat without brim. |
| Retention bead wear | Medium | 0.5mm shallow bead repeatedly contacts PLA guide walls. |
| Firm-fit whitening | Medium | 1.103mm³ local CAD interference may be too aggressive. |
| Tall block moment | Medium | 58mm visible height magnifies wobble and pull moment. |
| Top-surface bridging classification | Medium | Slicer reports substantial bridge time over sparse infill; inspect top flatness. |
| Grip relief surface | Low | Small front relief must remain clean at 0.20mm layers. |
| First-layer footprint | Low | Broad, stable surfaces; no brim required by the current slice. |

## Layer-direction review

The Base beads are short horizontal features integrated into thick socket walls rather than long cantilevers. The module guide is printed vertically from the build plate, so lateral loads are distributed across perimeter walls. A failed Firm fit can still damage bead edges or delaminate locally; the first test must progress Light → Standard → Firm.

## DFAM status

`printable-with-medium-prototype-risk`

This is a prototype assessment, not a load or durability certification.

