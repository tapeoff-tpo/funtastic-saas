# FUN-TASTIC Platform Interface V0

Status: `ready-for-user-print-approval`

Printer transfer: `blocked-printer-unreachable` as of 2026-07-18. The sliced
3MF is complete, but the configured P2S did not answer the read-only LAN probe.
No file was uploaded and no print was started.

This project creates three PLA-only interface specimens for a controlled physical comparison:

- A: guided slide plus terminal shallow detent
- B: hook-and-slide plus terminal catch
- C: three-point short-turn bayonet plus terminal throat

The files are test fixtures, not a finished product or approved proprietary standard.

## Build

```bash
funtastic build /absolute/path/to/products/platform-interface-v0
funtastic doctor /absolute/path/to/products/platform-interface-v0/stl/main.stl
```

If the installed Product Factory still points to the old Codex app Node path,
run the checked-in compatibility wrapper with the Product Factory Python:

```bash
/path/to/.local-tools/product-factory/bin/python \
  build/run_product_factory_compat.py --project "$PWD"
```

The installed Product Factory is allowed to generate STEP, STL, renders, validation reports, G-code, and a sliced 3MF. It must not upload or start a print.

## Files

- `parameters/parameters.json`: all V0 functional and print inputs
- `cad/common_test_body.py`: common envelope, handle/load hole, marks, and mass equalizer
- `cad/interface_a.py`: continuous guided rail
- `cad/interface_b.py`: two discrete hook lugs
- `cad/interface_c.py`: three short-turn lugs and tracks
- `cad/model.py`: exports six parts and one combined P2S plate
- `step/`, `stl/`, `3mf/`: generated manufacturing artifacts
- `reports/`: dimensions, DFAM, slicing, and design notes
- `test/`: blank physical scorecard and print checklist

## Physical Orientation

Both Base and Module print flat with their interface faces upward. For use, turn the Module over so its interface face meets the Base. The common through-hole near the top edge is the hand grip and low-load attachment point.

## Comparison Boundary

The following remain common across A/B/C:

- 64 x 72 mm Base envelope
- 64 x 72 mm Module envelope
- Common load-hole location
- Common plate and print profile
- PLA-only construction
- Identical nonfunctional volume-equalization method

Only the interface geometry and required insertion motion differ.

## Stop Condition

The project must stop at `ready-for-user-print-approval`. Physical scores stay blank until the user prints and tests the specimens.
