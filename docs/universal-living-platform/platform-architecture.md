# FUN-TASTIC Universal Living Platform - Platform Architecture

Checked: 2026-07-18

## Architectural Decision

Use **one interface protocol across multiple Base classes**, not one identical physical Base for every environment.

This preserves the customer promise of compatibility while respecting differences in moisture, heat, mounting surface, orientation, portability, and load.

## Layer Model

| Layer | Responsibility | Shared across Zones? | Current status |
|---|---|---|---|
| 1. Interface protocol | Attachment motion, orientation, retention language, compatibility version | Yes | Phase 5 selected three families for physical validation |
| 2. Base class | Carries modules and transfers load to a surface or support | No; environmental variants required | Strategy only |
| 3. Module chassis | Presents the shared interface to the functional body | Yes where the load class permits | Strategy only |
| 4. Functional module | Tray, cup, hook, holder, clip, dock, divider, label and variants | Shared family; object geometry varies | Taxonomy defined |
| 5. CMF system | Neutral Bases, curated color families, finish and personalization | Shared brand rules | Unvalidated |
| 6. Catalog profile | Zone, load, material, environment, compatibility, version and instructions | Yes | Governance requirement |
| 7. Starter Kit | Curated first job and expansion path | Zone-specific | Strategy defined |

## Base Classes

### A. Dry stationary Base

- Study, Work, Bedroom, Kids, Living Room and dry Beauty
- PLA-first launch territory
- Low load, indoor temperature, no direct water

### B. Dry mounted Base

- Entryway and selected vertical desk/living applications
- Requires separate adhesive, clamp, or fastener evidence
- The interface may be universal; mounting claims are not

### C. Portable Base

- Travel, cafe, school-to-home and mobile routines
- Must validate carry loads, drops, loose-part retention, and packing volume

### D. Humid or wet Base

- Bathroom, Kitchen-wet and Laundry-humid
- Not part of the PLA-first MVP
- Requires material, drainage, cleaning, adhesive, and surface validation

### E. Elevated-load Base

- Heavy tools, large shelves, safety-critical hanging, and high-impact use
- Outside the current platform promise

## How Many Zones Can One Common Base Cover?

One **dry stationary physical Base** can credibly cover six Zones without changing its basic environment claim:

1. Study
2. Work
3. Bedroom
4. Kids
5. Living Room
6. Beauty in a dry location

Five more are conditional:

- Coffee: dry tools only, away from heat and splashes
- Entryway: mounting system and variable load must be validated
- Pet: lightweight accessories only
- Kitchen: dry sub-zone only
- Laundry: dry storage only, outside sustained humidity

Travel needs a portable Base. Bathroom needs a wet-zone Base. Therefore one physical Base does **not** credibly cover all thirteen Zones, but one interface protocol can.

## Universal Interface Boundary

The platform standard must define behavior before geometry is finalized:

- One obvious attachment direction
- One confirmed end state
- Intentional one-hand release where the module load permits
- No continuous PLA spring load in the primary load path
- Orientation and load-class labeling
- Backward-compatible versioning
- A service strategy for the tactile retention element
- No visual dependence on LEGO studs, proportions, or trade dress

Phase 5 recommends guided slide plus terminal detent as the primary family, hook-and-slide as the low-risk comparator, and short-turn bayonet as the playful comparator. None is a frozen proprietary standard yet.

## Catalog Object Model

Every sellable module should be described by:

- Interface version
- Base-class compatibility
- Zone tags
- Environment class
- Load class
- Module family
- Object-fit profile, if any
- Material
- Color and finish
- Installation orientation
- Required service part
- Package or Starter Kit membership

This metadata is what allows 1000 logical SKUs to remain navigable.

## Architecture Risks

1. One connector can become mechanically compromised if it is forced to handle every load and orientation.
2. Multiple Base classes can confuse customers unless compatibility is visually simple.
3. A proprietary interface has no value until the Starter Kit and follow-up catalog are useful.
4. Small interface changes can strand earlier modules.
5. Adapters can expand reach but can also multiply support and fit failures.
6. Wet-zone expansion can damage the brand if PLA-first assumptions are carried forward.
7. A 1000-SKU catalog can become impossible to browse without strong metadata and retirement rules.

## Governance Gates

- Do not freeze the interface before Top 3 physical comparison.
- Do not add a Base class without a new environmental validation plan.
- Do not launch a Zone unless at least one Starter Kit and a credible follow-up path are present.
- Do not count color-only variants as module innovation.
- Do not break backward compatibility without a documented adapter or migration decision.
