# Facet Totem Fit Coupon

Status: `ready-for-fit-coupon-print-approval`

This package isolates the Phase 9.3 Light, Standard, and Firm fits before the 208.78g full prototype plate is printed. Each fit has its own Socket Coupon and Test Plug so wear or damage cannot contaminate another result.

## Scope

- Same Facet footprint, guide, socket, stop, retention beads, pockets, layer direction, and print profile as Phase 9.3
- Reduced nonfunctional Socket flange and Plug grip height
- Three independent pairs on one plate
- No selection of a winning fit before physical results

The final Coupon uses a 50×50×10mm Socket body and a 46×46×8mm visible open-top grip. The open grip uses the parent 2.0mm shell and 2.4mm bottom parameters; the interface below it is unchanged.

## Build

```sh
PYTHON=/Users/chowol/Documents/Codex/2026-07-14/saa/funtastic-saas/.local-tools/product-factory/bin/python
$PYTHON cad/fit_coupon.py --project .
$PYTHON build/validate_coupon.py --project .
/Applications/Blender.app/Contents/MacOS/Blender --background --python build/render_coupon.py -- .
```

## Print gate

3MF and G-code are prepared locally. No printer upload or print start has occurred. The full Phase 9.3 plate remains blocked until a fit survives the Coupon test.

