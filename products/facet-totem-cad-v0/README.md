# Facet Totem CAD V0

Status: `ready-for-user-print-approval`

This project translates the approved Phase 9.2 Facet Totem direction into a physical PLA fit prototype. It is not a finished Starter Kit or saleable accessory family.

## Prototype contents

- One neutral 2x2 Base
- Low, Medium, and Tall blocks using the Standard interface
- Three identical Medium blocks using Light, Standard, and Firm fit variants
- A single direct Push-In/Pull-Out interface family

Modules never connect to or stack on one another. The Base owns the array and interface standard.

## Build

```sh
PYTHON=/Users/chowol/Documents/Codex/2026-07-14/saa/funtastic-saas/.local-tools/product-factory/bin/python
$PYTHON cad/model.py --project .
$PYTHON build/validate_geometry.py --project .
/Applications/Blender.app/Contents/MacOS/Blender --background --python build/render_cad.py -- .
```

The generated dimensions and fits are `V0 experimental, unvalidated`. Physical print results must be recorded in `test/` before any interface is selected.

## Print safety gate

The 3MF and G-code are prepared but have not been sent to a printer. User approval is required before printing.

IP status: `IP review required` before commercialization.

