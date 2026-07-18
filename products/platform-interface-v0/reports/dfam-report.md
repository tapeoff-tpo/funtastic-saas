# Platform Interface V0 - DFAM Report

Status: `automatic-checks-passed; physical-review-required`

## Automated Results

- STEP solids: 6, valid
- Combined STL: watertight, winding-consistent, valid volume
- Plate envelope: 212.0 x 156.0 x 8.8 mm
- P2S 256 mm cube fit: pass
- Bed-contact faces: 1,464
- Declared minimum wall: 1.6 mm, parameter check pass
- Support generation: disabled
- Brim: disabled by the declared V0 profile
- Print orientation: all six bodies flat, interface face upward

## Structure Review

- A transfers load through two continuous capped rails; the terminal bump is
  intended for confirmation and retention, not primary load transfer.
- B transfers load through two discrete capped hooks; local contact pressure and
  accidental upward lift-out require physical testing.
- C transfers load through three capped lugs and curved tracks; arc friction and
  terminal throat wear are expected to be the most tolerance-sensitive.
- Detents and catches are shallow rigid features. No living hinge or deep
  cantilever snap-fit is present.
- Both mating pieces print flat, avoiding a primary rail/lug build in the weak
  layer-peel direction.

## Open Risks

The mesh heuristic found 10.245 cm2 of downward-facing area while supports are
disabled. This corresponds mainly to captured channel and track roofs. Bambu
Studio sliced the geometry without an error, but roof sag, rough first contact,
and increased insertion force must be inspected on the first print.

Automatic risk level: `medium`.

The following remain human or physical checks: exact bridge quality, load-path
fillets, stress concentration, layer-direction failure, insertion force,
retention, wear, whitening, debris, and 100-cycle durability.
