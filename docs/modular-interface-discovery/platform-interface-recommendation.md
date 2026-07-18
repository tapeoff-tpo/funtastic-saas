# FUN-TASTIC Platform Interface Recommendation

Checked: 2026-07-18

## Final Direction

### Primary: Guided Slide + Terminal Detent

Why it leads:

- The slide path can carry normal module load without continuously bending PLA.
- The final detent can provide the desired click without being the main structural support.
- The motion is visible and understandable to a beginner.
- One-hand attach and detach are plausible without lifting the Base.
- The end state can be communicated through sound, touch and visual alignment.
- The family can scale from trays to cups, cable modules and lightweight desk accessories.
- Rounded, colorful module bodies can carry the cute brand language without copying a brick interface.

Unverified:

- Actual force, clearance, wear, sound and cycle life
- Whether users prefer a straight slide to a rotating motion
- Whether the Base remains stable during one-hand removal

### Secondary: Hook-and-Slide + Terminal Catch

Why it remains:

- Proven tool-free logic in SKADIS-style and rail systems
- Gravity can carry the load without PLA spring preload
- Easy module scaling and print orientation options
- Lower conceptual and manufacturing complexity

Limitation:

- The interaction is useful but less distinctive.
- Poorly retained hooks can lift with the object being removed.

### Experimental: Short-Turn Bayonet + Detent

Why it deserves a test:

- Insert-and-turn creates a compact ritual and stronger sense of assembly.
- Rotation can deliver a visible before/after state.
- It is more ownable as a brand interaction than a generic hook.

Limitation:

- Rotation space, wear, orientation and tolerance are less forgiving.
- The motion may be excessive for very small or closely packed modules.

## Top 10

| Rank | Interface family | Score |
|---:|---|---:|
| 1 | Guided slide + terminal detent | 94 |
| 2 | Hook-and-slide + terminal catch | 92 |
| 3 | Short-turn bayonet + detent | 90 |
| 4 | Keyed gravity drop-in grid | 88 |
| 5 | Magnetic-mechanical dock | 88 |
| 6 | Unlatched guided rail | 86 |
| 7 | Gravity hook lock | 84 |
| 8 | Tapered wedge lock | 82 |
| 9 | Tapered dovetail slide | 80 |
| 10 | Replaceable spring clip | 80 |

Ball detent also scored 80, but falls outside the Top 10 because it requires separate metal hardware and assembly while offering no validated market advantage for this PLA-first MVP.

## Not Recommended

- **PLA living-hinge latch:** repeated flex and layer-direction risk conflict with platform life.
- **Pure press fit:** insertion force changes too much with FDM tolerance and wear.
- **Deep cantilever snap as the main lock:** delightful initially but too dependent on repeated PLA flex.
- **Multi-turn thread:** reliable but too slow for frequent playful rearrangement.
- **Cam lock:** unnecessary parts and cognitive steps for a lightweight desk system.
- **Pure magnet dock:** easy to use but may detach accidentally; magnetic-mechanical locking is the safer benchmark.

## Existing Platform Lessons

| Platform | Interface choice | Why the choice fits its market | Limitation observed |
|---|---|---|---|
| Gridfinity | Keyed gravity drop-in | Drawer and desktop modules need fast rearrangement without fatigue | No positive retention; limited tactile event |
| SKADIS | Hook/slot | Tool-free wall organization and easy repositioning | Hooks can lift or rotate with removed objects |
| KUNGSFORS/HULTARP | Rail/S-hook | Low-cost universal hanging with almost no learning | Weak differentiation and no positive lock |
| Multiboard | Snaps, bolts and rail sliders | Wide wall ecosystem needs multiple retention levels | Terminology and part breadth increase learning burden |
| openGrid | Normal, directional and lock snaps | Printable ecosystem serves light to stronger retention needs | More connector variants increase choice complexity |
| balolo Setup Cockpit | Screw-mounted grid | Premium desk accessories prioritize stability and hidden attachment | Rearrangement requires tools and is not playful |
| FIDLOCK benchmark | Magnetic guidance + mechanical lock | One-hand self-alignment, audible click and memorable release | Patented hardware, added BOM and non-PLA components |
| Bubbluu BLOCK | Reusable suction Base and modular assortment | No-drill, movable bathroom positioning is the main value | Exact internal module interface was not verified in this phase |

## Principles for a Future Proprietary Standard

1. Make the motion ownable, not the appearance derivative.
2. Use one primary attach motion and one related release motion.
3. Separate structural load support from tactile confirmation.
4. Avoid constant flex in PLA.
5. Ensure partial engagement is obvious.
6. Allow one-hand removal without lifting the Base.
7. Keep the same user grammar across all 100 future SKUs.
8. Make module orientation clear without written instructions.
9. Treat sound, force curve and rattle as product requirements.
10. Preserve a fallback release path if the detent wears or jams.
11. Avoid LEGO studs, brick proportions, clutch geometry and compatibility implications.
12. Conduct IP review before naming or freezing a proprietary mechanism.

## Decision Gate

Proceed to physical interaction prototypes only after approving these three interface families for comparative testing. The next phase should compare UX and cycle behavior, not product styling or a complete product catalog.

## Verdict

# GO WITH LIMITATIONS

The market and material evidence are sufficient to narrow the comparison to three families. They are not sufficient to select final geometry or declare a proprietary standard.
