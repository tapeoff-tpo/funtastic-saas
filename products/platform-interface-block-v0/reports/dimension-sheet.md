# Block-Form Universal Interface V0 - Dimension Sheet

Status: `V0-experimental-unvalidated`

All values are millimetres. `parameters/parameters.json` is the source of truth.
Fit dimensions are independent parameters and are not controlled by global scaling.

## Common Visible Envelope

| Dimension | Base | Module | Assembled |
|---|---:|---:|---:|
| Width | 44.0 | 38.0 | 44.0 |
| Height | 44.0 | 38.0 | 44.0 |
| Depth | 7.0 | 16.0 | 23.0 |
| Corner radius | 5.0 | 4.5 | - |

- Base reveal after assembly: 3.0 per side
- Grid pitch: 47.0
- Interface working area: 27.0 x 27.0
- Interface depth: 2.8
- Insertion clearance: 0.35
- Side clearance: 0.30
- End clearance: 0.40
- Declared minimum wall: 1.60
- Detent: 3.8 diameter x 0.30 high
- Detent pocket depth: 0.55

## A - Guided Slide

- Rail spacing / length: 12.0 / 19.0
- Rail neck / cap width: 3.8 / 6.0
- Rail neck / cap height: 0.8 / 1.6
- Open channel path: Y -19.2 to 10.0
- Terminal detent Y: 7.0

## B - Hook-and-Slide

- Hook spacing: 14.0
- Slide distance: 8.0
- Hook neck: 4.6 x 4.6
- Hook cap: 7.6 x 7.6
- Hook neck / cap height: 0.8 / 1.6
- Entry / terminal Y: -8.0 / 0.0

## C - Short-Turn Bayonet

- Lug count / radius: 3 / 9.5
- Lug neck / cap diameter: 4.2 / 7.0
- Lug neck / cap height: 0.8 / 1.6
- Rotation angle: 22 degrees
- Terminal throat reduction: 0.18

## Comparison Control

| Interface | Pair volume (mm3) | Deviation from mean |
|---|---:|---:|
| A | 35,733.888 | -0.080% |
| B | 35,699.354 | -0.177% |
| C | 35,854.496 | +0.257% |

Maximum pair-volume spread is 0.434%, so no visible equalizer holes were added.
The exported print Plate envelope is 148.0 x 97.0 x 16.0.
