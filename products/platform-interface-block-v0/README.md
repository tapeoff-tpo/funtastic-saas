# FUN-TASTIC Platform Interface Block V0

Status: `ready-for-user-print-approval`

Printer transfer: `not-attempted`. CAD, the sliced 3MF and G-code are ready,
but no file was uploaded and no print was started.

Phase 9.1 converts the three Phase 9 interface principles into a compact,
hand-grippable block family. The earlier flat coupons remain unchanged at
`products/platform-interface-v0/` and must not be printed as part of this run.

## Comparison

- A: guided dovetail slide plus terminal detent
- B: two-point hook-and-slide plus terminal catch
- C: three-point short-turn bayonet with terminal throat

Every variant uses a 44 x 44 mm Base and a 38 x 38 x 16 mm Module. The 3 mm
Base reveal, rounded square family and 23 mm assembled depth remain common.
Only the hidden mating geometry and required assembly motion differ.

## Build

```bash
/path/to/product-factory/python cad/model.py --project "$PWD"
/path/to/product-factory/python build/run_product_factory_compat.py --project "$PWD"
```

The build may generate CAD, mesh, renders, G-code and a sliced 3MF. It must not
upload a file or start a print.

## Stop Condition

The final state is `ready-for-user-print-approval`. Physical scores remain blank
until the user prints and handles the specimens.
