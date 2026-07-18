# Block Direction Approval Checklist

## Current status

`approved-for-phase-9-3-cad`

## Visual hard gates

- [x] First glance reads as a block family.
- [x] Direct press-in assembly is visible.
- [x] The concepts do not read as rail or twist-lock products.
- [x] Multiple blocks create a collectible composition.
- [x] Living-product modules share a common visual grammar.
- [x] No LEGO logo, stud field, exact brick proportion, or compatibility claim is used.
- [x] The concepts differ from the Phase 9.1 product-on-dock interpretation.
- [x] The assembly story can be understood from the hand, open cell, seated state, and pull sequence.

## Evidence limits

- [ ] Push force validated in PLA
- [ ] Pull force validated in PLA
- [ ] Retention and wobble validated
- [ ] 100-cycle wear validated
- [ ] Adjacent-module clearance validated
- [ ] Final dimensions and print orientation validated

Unchecked items require CAD and physical prototypes after direction approval. They are not failures of this visual phase.

## User-approved decision

The user approved the product architecture and visual direction with the following constraints:

1. One large common Base plate controls the array and common interface standard.
2. Modules mount independently into positions on the Base; modules do not connect directly to one another horizontally or vertically.
3. Primary installation is a straight Push-In and primary removal is a straight Pull-Out.
4. Slide, hook-and-slide, and rotational locking actions are excluded.
5. Direction B, **Facet Totem Blocks**, is the approved visual reference.
6. The family keeps B's faceted block and collection language without forcing every function to the same height.
7. Tray, Cup, Cable, Phone Rest, and later functions share a common footprint and design language while their heights follow their function.
8. Direction A's capsule-like expression and Direction C's replaceable frame/core expression are not part of the approved direction.
9. The desired experience is direct pressing, a satisfying seating event, and collectible color composition.
10. LEGO logos, stud geometry, brick proportions, and compatibility standards remain prohibited.

This approval covers product architecture and visual direction only. It does not approve internal retention geometry, dimensions, force, durability, or a final product.

## Phase 9.3 CAD requirements

- Develop a parametric common Base plate with repeated module positions.
- Develop one shared module footprint and mating datum for all test modules.
- Keep module height independent so each function can use the minimum appropriate volume.
- Compare straight Push-In/Pull-Out retention geometries without introducing secondary slide or rotation actions.
- Separate load-bearing guidance from tactile seating feedback where practical.
- Parameterize fit clearance, lateral clearance, insertion depth, retention feature, fillets, shell, and module height independently.
- Provide at least neutral test bodies representing low Tray, medium Cable/Phone Rest, and tall Cup proportions.
- Check one-handed grip, adjacent-module finger access, partial seating visibility, removal clearance, wobble, and accidental release.
- Design for PLA on Bambu Lab P2S using the standard 0.4 mm nozzle and 0.20 mm profile, with support-free output as the default target.
- Treat all initial dimensions and fit values as V0 test values until physical validation.

## Next-step gate

Direction approval is complete. CadQuery, STEP, STL, 3MF, slicing, and physical test preparation may begin only under the separate Phase 9.3 task. No CAD artifact was generated as part of this approval update.
