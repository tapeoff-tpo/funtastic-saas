# FUN-TASTIC Discover Evidence Builder

Version: 2.0.0

`funtastic discover <sku>` builds a traceable evidence package. It does not
perform market research, interpret VOC, generate concepts, or create CAD.

## Command

```bash
npm run funtastic -- discover 101518-0001 \
  --snapshot /private/path/opportunities/current/source_snapshot.json \
  --output /private/path/products
```

## Inputs

Required:

- Opportunity `source_snapshot.json`
- SKU present in that snapshot

Automatically attempted:

- Funtastic B2B product search and detail API

Optional human inputs:

```text
products/<sku>/inputs/
  product-images/
  measurements.json
  reviews.csv
  competitor-urls.csv
  notes.md
```

Example `measurements.json`:

```json
{
  "dimensionsMm": { "x": 40, "y": 30, "z": 20 },
  "material": "PETG",
  "loadKg": 0.5,
  "mountingMethod": "adhesive",
  "estimatedPrintTimeMinutes": 35,
  "estimatedFilamentGrams": 14,
  "measuredAt": "2026-07-17"
}
```

Print time and filament fields remain user-supplied estimates until a mesh and
slicer result exist. Discover does not fabricate them from a bounding box.

## Outputs

Every execution creates an immutable run and refreshes `current`:

```text
products/<sku>/discovery/
  runs/<timestamp>/
    manifest.json
    internal-product.json
    official-product.json
    physical-evidence.json
    printability.json
    evidence-gaps.json
    discovery-status.json
    discovery-report.md
  current/
    ...same eight files...
```

No empty market, VOC, competitor, strategy, CMF, or manufacturing Markdown is
created.

## Status Gates

- `insufficient-input`: malformed internal identity
- `internal-only`: internal SKU loaded, no official or physical evidence
- `official-loaded`: official product loaded, no physical evidence
- `physical-loaded`: physical input loaded, official product unavailable
- `ready-for-market-research`: official and physical evidence loaded
- `ready-for-concept-generation`: reserved for a later stage; Discover 2.0 never
  emits it because loading reviews and competitor URLs is not completed research

Market research, VOC interpretation, competitor research, and concept generation
are always recorded separately as `not-performed` or `input-loaded-not-analyzed`.

## Printability Boundary

Discover can decide bounding-box fit only when complete dimensions exist. Without
dimensions, build-volume fit and split-print need remain `unknown`. Without a mesh
and slicer result, print time and filament usage remain `unknown`. A product-name
screening signal is explicitly labeled `keyword-only` and never produces a numeric
manufacturing claim.

The default P2S build volume is 256 x 256 x 256 mm, sourced from Bambu Lab's
official P2S announcement and recorded with its check date in `printability.json`.
