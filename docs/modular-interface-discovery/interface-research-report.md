# Project FUN-TASTIC - Modular Interface Research Report

Checked: 2026-07-18

## Executive Summary

The best direction for the PLA-first desk platform is **guided slide plus terminal detent**. It offers a familiar one-hand motion, a satisfying end-state click, low dependence on continuous PLA flex, and enough visual freedom for a cute pastel or vivid brand.

Two alternatives should remain in comparative testing:

1. Hook-and-slide plus terminal catch: lowest-risk, most familiar
2. Short-turn bayonet plus detent: most ritualized and playful

The project should not use a PLA living hinge, pure repeated press fit or deep cantilever snap as the core 100-SKU interface.

**Final verdict: GO WITH LIMITATIONS.** This phase selects interface families for research. It does not define geometry, tolerances, CAD or STL.

## 1. Research Scope

Sixteen interface families were evaluated against ten equal criteria:

- Assembly fun
- Cute-design compatibility
- One-hand attachment
- One-hand removal
- Repeated-cycle durability
- PLA suitability
- FDM tolerance robustness
- Print-orientation freedom
- Small-module suitability
- Brand differentiation

Each criterion is scored from one to five and normalized to 100 points. Scores are pre-prototype comparative judgments based on platform evidence and plastics joining guidance, not measured forces or cycle results.

## 2. Why Existing Platforms Chose Their Interfaces

### Gridfinity - gravity drop-in

Gridfinity modules rest in a standardized grid because drawers and desks already provide a stable orientation. No flexing connector is required, tolerances are forgiving and rearrangement is instant. Its weakness is the lack of a memorable lock or inverted retention.

### IKEA SKADIS - hook and slot

SKADIS optimizes tool-free attachment and movement across a wall board. IKEA explicitly describes accessories as easy to attach and move without tools. Customer reviews validate ease and versatility, while other reviews and Phase 2 evidence show that some hooks can lift or rotate during object removal.

### Kitchen rail systems - hook and rail

KUNGSFORS and HULTARP use rails and S-hooks because customers understand them immediately and can move accessories without mechanisms. KUNGSFORS hook reviews mention repeated purchases and use across multiple areas. The interface is commercially robust but difficult to own as a distinctive brand interaction.

### Multiboard - snaps, bolts and rails

Multiboard serves a wide wall-storage ecosystem, so it provides different connection levels rather than one universal fastener. Its official library includes snaps, bolts, rods and rail sliders. Strength and flexibility increase, but so does onboarding complexity.

### openGrid - graduated snap retention

openGrid documents normal, directional and rotating lock snaps. The family lets users select light, directional or rigid retention and supports adapters to other ecosystems. This demonstrates platform scalability, but also the risk of too many connector variants.

### balolo - screw grid

balolo's premium desk shelf uses multiple underside mounting points. Accessories are repositioned by unscrewing and reattaching them. This favors stability and invisible attachment, but the tool step reduces playful rearrangement.

### FIDLOCK - magnetic guidance and mechanical lock

FIDLOCK is a UX benchmark rather than a geometry to copy. Its official description combines magnetic self-guidance with a mechanical audible click and one-hand release. It proves that alignment, confirmation and simple release can make a fastener memorable. It also carries patent, BOM and non-PLA constraints.

## 3. Interface Comparison

| Rank | Interface family | Score | Main advantage | Main risk |
|---:|---|---:|---|---|
| 1 | Guided slide + terminal detent | 94 | Load guidance plus playful confirmation | Detent fatigue or binding |
| 2 | Hook-and-slide + terminal catch | 92 | Familiar, gravity-assisted and PLA-friendly | Can lift during removal |
| 3 | Short-turn bayonet + detent | 90 | Memorable insert-and-turn ritual | Rotation and tolerance sensitivity |
| 4 | Keyed gravity drop-in | 88 | Highest tolerance and cycle robustness | Weak click and inverted retention |
| 5 | Magnetic-mechanical dock | 88 | Best self-alignment and one-hand delight | Added hardware, IP and safety constraints |
| 6 | Unlatched guided rail | 86 | Simple and durable | No positive end confirmation |
| 7 | Gravity hook lock | 84 | Beginner-friendly and low strain | Low differentiation |
| 8 | Tapered wedge lock | 82 | Self-tightening without springs | Can jam as surfaces wear |
| 9 | Tapered dovetail | 80 | Strong guiding and load distribution | Long sliding friction magnifies error |
| 10 | Replaceable spring clip | 80 | Clear click and serviceable fatigue part | Added replacement/support logic |
| 11 | Ball detent | 80 | Excellent tactile event | Separate hardware and assembly |
| 12 | Multi-turn twist/thread | 76 | High retention | Slow, cross-thread risk |
| 13 | Cantilever snap fit | 72 | Immediate click | PLA repeated-flex fatigue |
| 14 | Cam lock | 70 | Strong and controllable | Too many steps and parts |
| 15 | Pure press fit | 64 | Simple geometry | Poor repeated-force consistency |
| 16 | PLA living-hinge latch | 60 | Cute motion potential | Material/process mismatch |

The CSV contains all ten component scores.

### Top 10 criterion ratings

| Rank | Interface family | Fun | Cute | One-hand attach | One-hand detach | Cycle life | PLA | Tolerance | Orientation | Small modules | Brand |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Guided slide + terminal detent | ★★★★★ | ★★★★★ | ★★★★★ | ★★★★★ | ★★★★☆ | ★★★★★ | ★★★★☆ | ★★★★☆ | ★★★★★ | ★★★★★ |
| 2 | Hook-and-slide + terminal catch | ★★★★☆ | ★★★★★ | ★★★★★ | ★★★★☆ | ★★★★★ | ★★★★★ | ★★★★☆ | ★★★★☆ | ★★★★★ | ★★★★★ |
| 3 | Short-turn bayonet + detent | ★★★★★ | ★★★★★ | ★★★★★ | ★★★★★ | ★★★★☆ | ★★★★☆ | ★★★★☆ | ★★★☆☆ | ★★★★★ | ★★★★★ |
| 4 | Keyed gravity drop-in | ★★☆☆☆ | ★★★★★ | ★★★★★ | ★★★★★ | ★★★★★ | ★★★★★ | ★★★★★ | ★★★★★ | ★★★★★ | ★★☆☆☆ |
| 5 | Magnetic-mechanical dock | ★★★★★ | ★★★★★ | ★★★★★ | ★★★★★ | ★★★★★ | ★★★☆☆ | ★★★★☆ | ★★★★☆ | ★★★★☆ | ★★★★☆ |
| 6 | Unlatched guided rail | ★★☆☆☆ | ★★★★☆ | ★★★★★ | ★★★★★ | ★★★★★ | ★★★★★ | ★★★★☆ | ★★★★★ | ★★★★★ | ★★★☆☆ |
| 7 | Gravity hook lock | ★★☆☆☆ | ★★★★☆ | ★★★★★ | ★★★★☆ | ★★★★★ | ★★★★★ | ★★★★★ | ★★★★★ | ★★★★★ | ★★☆☆☆ |
| 8 | Tapered wedge lock | ★★★☆☆ | ★★★★☆ | ★★★★☆ | ★★★★☆ | ★★★★★ | ★★★★★ | ★★★★☆ | ★★★★☆ | ★★★★☆ | ★★★★☆ |
| 9 | Tapered dovetail | ★★★☆☆ | ★★★★☆ | ★★★★☆ | ★★★★☆ | ★★★★★ | ★★★★★ | ★★★☆☆ | ★★★★☆ | ★★★★☆ | ★★★★☆ |
| 10 | Replaceable spring clip | ★★★★☆ | ★★★★☆ | ★★★★★ | ★★★★☆ | ★★★★☆ | ★★★★☆ | ★★★☆☆ | ★★★☆☆ | ★★★★★ | ★★★★☆ |

These ratings compare interface families under the stated PLA-first desk-platform constraints. They are not measured performance claims.

## 4. Interface Advantages and Disadvantages

### Slide and rail families

Advantages:

- Motion is visually legible.
- Load can be transferred through broad surfaces.
- Flexing can be limited to a small confirmation feature.
- Module size can vary while preserving the same interaction grammar.

Disadvantages:

- Long contact paths can bind.
- Debris and surface wear change friction.
- An unlatched rail provides no clear completion signal.

### Hook families

Advantages:

- Fast, familiar and gravity-assisted.
- Low repeated strain in PLA.
- Broad print-orientation options.

Disadvantages:

- Modules may lift with the stored object.
- Pure hooks have low brand differentiation.
- One-hand removal can move the Base if release direction is poorly matched.

### Bayonet and twist families

Advantages:

- A short ritual creates a clear before/after state.
- Rotation can combine alignment and retention.
- The motion is visually distinctive without looking like a brick toy.

Disadvantages:

- Requires rotation clearance around adjacent modules.
- Curved/contact features can be orientation-sensitive.
- Users need a visible cue for the final angle.

### Snap and clip families

Advantages:

- Strong tactile and audible confirmation.
- Fast one-hand attachment.
- Small geometry can fit many modules.

Disadvantages:

- Repeated strain and creep are problematic in PLA.
- Force varies with print orientation and filament.
- Hidden snaps can encourage users to apply unsafe force.

### Magnetic-mechanical families

Advantages:

- Best self-alignment and approach tolerance.
- Memorable automatic close.
- One-hand accessibility.

Disadvantages:

- Added components, polarity control and assembly.
- Magnet safety considerations for children and electronics.
- Patented mechanisms must not be copied.

## 5. PLA Failure Risks

The central PLA risk is not absolute strength. It is repeated strain concentrated into a small feature.

High-risk conditions:

- Snap arm kept permanently deflected
- Flex across Z layers
- Deep undercut requiring large release strain
- Sharp root transition
- Friction-only press fit calibrated to one printer/color
- Long dovetail with high preload
- Thin living hinge

Lower-risk conditions:

- Gravity seating
- Broad guided slide
- Short low-strain confirmation detent
- Separate replaceable click element
- Positive hard stop
- Load path independent from the click feature

No final cycle life can be claimed without printed test coupons and interface prototypes.

## 6. UX Findings

### Most fun

- Magnetic-mechanical dock
- Short-turn bayonet with detent
- Guided slide with terminal detent

### Most intuitive

- Gravity drop-in
- Hook-and-slide
- Guided slide

### Most robust in PLA

- Gravity drop-in
- Hook lock
- Unlatched rail
- Guided slide where the detent carries no sustained load

### Best for cute brand expression

- Guided slide with a visible completion cue
- Short-turn bayonet with an orientation cue
- Magnetic-mechanical dock with a distinct release gesture

The connector should remain visually subordinate. The module silhouette, color, release cue and sound should carry the brand.

## 7. Scaling to 100 SKUs

An interface scales when every new module can reuse the same user grammar without requiring a new connector lesson.

Requirements:

- One connection family across lightweight modules
- Clear size/orientation rules
- No device-specific connector variants unless essential
- A module can grow in volume without changing attach/release behavior
- Failure of one module does not damage the Base
- Replacement and version identification remain understandable
- The Base can accept color and category expansion without appearing technical

Guided slide and hook-and-slide score best because the supporting surfaces can scale independently from the accessory body. Short-turn bayonet remains viable for smaller modules but may constrain packing density.

## 8. Brand and IP Boundary

The platform must not use:

- LEGO-compatible studs
- Brick ratios or characteristic brick silhouettes
- Cylindrical clutch tubes
- Marketing that implies LEGO compatibility
- A proprietary magnetic fastener copied from FIDLOCK

The brand can own:

- Its attach/release motion sequence
- Sound and tactile target
- Color coding
- Completion icon
- Naming system
- Rounded module family language
- Packaging and guided assembly experience

A formal IP review is required before finalizing or naming any proprietary interface.

## 9. Top 3 Recommendation

### 1. Guided slide + terminal detent

Best overall balance of fun, comprehension, PLA behavior and 100-SKU expansion.

### 2. Hook-and-slide + terminal catch

Best low-risk baseline and easiest reference for first-time users.

### 3. Short-turn bayonet + detent

Best playful alternative and strongest candidate for a recognizable assembly ritual.

## 10. Next Validation

The next phase should not build complete products. It should compare interface test pieces for:

- First-time comprehension
- One-hand attach and remove
- Force consistency across PLA colors/spools
- Click satisfaction
- Rattle
- Partial engagement
- 100-cycle user trial
- Extended engineering cycle test
- Base movement during removal
- Wear and visible debris

No interface should be selected from scoring alone.

## 11. Final Verdict

# GO WITH LIMITATIONS

Proceed with comparative physical validation of the Top 3 interface families. Do not declare a proprietary standard, create a full product catalog or finalize design geometry until user preference, print variation and cycle durability are measured.

## Sources

- openGrid snap guide: https://www.opengrid.world/guides/snaps/
- Multiboard knowledge hub: https://www.multiboard.io/knowledge-hub/
- Multiboard rail sliders: https://www.multiboard.io/parts-library/multipoint/rail-sliders
- Gridfinity documentation: https://gridfinity.xyz/
- IKEA SKADIS hook: https://www.ikea.com/es/en/p/skadis-hook-white-20519888/
- IKEA KUNGSFORS hook and reviews: https://www.ikea.com/us/en/p/kungsfors-s-hook-stainless-steel-20334922/
- balolo mounting grid: https://www.balolo.de/en/products/handyhalter
- FIDLOCK concept: https://www.fidlock.com/components/en/home-alt
- LANXESS plastic joining guide: https://techcenter.lanxess.com/scp/americas/en/docguard/Joining_Guide.pdf?docId=77016
- Protolabs living-hinge guide: https://www.protolabs.com/resources/design-tips/designing-living-hinges-that-fold-flat/
- Protolabs printed hinge guide: https://www.protolabs.com/resources/blog/how-to-design-3d-printed-living-hinges/
- Polymaker PLA TDS: https://wiki.polymaker.com/polymaker-products/more-about-our-products/documents/technical-data-sheets/pla/polylite-tm-pla
