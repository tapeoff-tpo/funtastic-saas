# Platform Interface V0 - Dimension Sheet

Status: `V0-experimental-unvalidated`

All dimensions are millimetres. They are independent experimental inputs, not
validated fit dimensions. `parameters/parameters.json` is the source of truth.

## Common Envelope

| Dimension | Base | Module |
|---|---:|---:|
| Width | 64.0 | 64.0 |
| Height | 72.0 | 72.0 |
| Body thickness | 6.0 | 5.0 |
| Corner radius | 4.0 | 4.0 |

- Common interface area: 36.0 wide x 42.0 long x 3.0 deep
- Insertion clearance: 0.40
- Side clearance: 0.35
- End clearance: 0.40
- Declared minimum wall: 1.60
- Common load/grip hole: 8.0 diameter at Y = 26.0
- Common nominal contact length: 34.0
- Common detent input: 0.35 high x 5.0 long

## Interface A - Guided Slide

- Rail spacing: 18.0
- Rail length: 42.0
- Rail neck/cap width: 4.2 / 7.2
- Rail neck/cap height: 1.2 / 1.5
- Entry length: 9.0
- Channel floor: 1.5

## Interface B - Hook-and-Slide

- Hook spacing: 28.0
- Slide distance: 10.0
- Hook neck: 6.0 x 6.0 x 1.2
- Hook cap: 10.0 x 10.0 x 1.5
- Catch depth: 0.60
- Channel floor: 1.5

## Interface C - Short-Turn Bayonet

- Lug count: 3
- Lug radius: 16.0
- Lug neck/cap diameter: 4.8 / 8.0
- Lug neck/cap height: 1.2 / 1.6
- Rotation angle: 24 degrees
- Terminal throat reduction: 0.25
- Channel floor: 1.4

## Plate And Material Control

- Exported plate envelope: 212.0 x 156.0 x 8.8
- Final pair volume: 48,616.304 mm3 for A, B, and C
- Maximum pair-volume difference after neutral cutouts: 0.000 mm3

The equalized volume controls material quantity only. It does not make the
interfaces structurally equivalent, and physical results must not be inferred
from these dimensions.
