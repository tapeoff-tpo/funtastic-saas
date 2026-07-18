# Fit Coupon DFAM Report

## Baseline

- Bambu Lab P2S
- Generic PLA
- 0.4mm nozzle
- 0.20mm Standard profile
- 2 wall loops
- 15% sparse infill
- Support disabled
- Brim disabled

## Findings

- All six parts use the same print and layer direction as Phase 9.3.
- Socket Coupons have broad first-layer contact and remain independent.
- Open-top Plug grips eliminate a closed roof while preserving parent shell and bottom values.
- No living hinge, deep cantilever, slide, twist, stud, or support-generated fit face exists.
- Plate envelope is 170×112×12.8mm and passes P2S build volume.
- Parts are separated by the authored 60mm column and 64mm row pitches.

## Risks

- The 8mm visible grip is intentionally minimal; verify it permits controlled Pull-Out.
- Firm retains 1.103mm³ local CAD interference and may whiten or damage PLA.
- Socket flange is smaller than the product Base and may lift sooner; that behavior must be recorded rather than treated as product Base performance.
- The slicer classifies significant internal/top-surface time as bridge behavior. Inspect socket floors and Plug shoulders before fit testing.

## Lightweight attempts

1. Initial solid 10mm grip / 54mm Socket: 66.63g, 1h45m41s.
2. Open-top parent shell: 63.21g, 1h42m25s.
3. Final 8mm grip / 50mm Socket: 55.78g, 1h30m44s.

The final result exceeds the target by 5.78g and 44 seconds. Further reduction would require weakening the Socket floor/walls or reducing the grip below a credible hand-test height, so interface fidelity and test reliability take priority.

