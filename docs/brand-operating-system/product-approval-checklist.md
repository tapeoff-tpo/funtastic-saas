# FUN-TASTIC Product Approval Checklist

Checked: 2026-07-18

## Decision Rule

A product must pass every hard gate before scoring.

- `PASS`: 80-100 and all hard gates pass
- `PASS WITH REVISION`: 65-79 and all hard gates pass
- `REJECT`: below 65 or any hard gate fails

These thresholds are proposed governance defaults and should be revised after real launch outcomes are available.

## Hard Gates

| Gate | Required evidence | Result |
|---|---|---|
| Customer job | A clear current job supported by customer, market, internal, or test evidence | PASS / FAIL |
| Day-one value | Useful without assuming future ecosystem breadth | PASS / FAIL |
| Platform truth | Real interface, Base, service, or catalog relationship | PASS / FAIL |
| Compatibility | Version and migration implications documented | PASS / FAIL |
| Environment | Material, Zone, load, cleaning, and mounting claims bounded | PASS / FAIL |
| Differentiation | Not a duplicate justified only by color, logo, or internal enthusiasm | PASS / FAIL |
| Service | Replacement, support, retirement, and ownership defined | PASS / FAIL |
| IP and claims | Trademark, trade dress, licensed content, safety, and performance claims reviewed | PASS / FAIL |

Any FAIL means REJECT or return to evidence collection before development continues.

## Scored Review

| Dimension | Weight | Review questions | Score |
|---|---:|---|---:|
| Customer value | 15 | Is the problem important and is the improvement legible? | /15 |
| Platform leverage | 15 | Does it increase the value of an existing Base or module? | /15 |
| Brand experience | 10 | Is interaction familiar, satisfying, and trustworthy? | /10 |
| Repeat and cross-Zone value | 10 | Is there a credible next purchase, reuse, or second-Zone path? | /10 |
| Design-language fit | 10 | Does it feel friendly, compact, legible, and coherent without imitation? | /10 |
| CMF and collection role | 5 | Does color or edition add navigation, expression, or story? | /5 |
| Naming and discoverability | 5 | Can customers find and understand the correct item? | /5 |
| Packaging and onboarding | 10 | Are job, compatibility, contents, limits, and first action clear? | /10 |
| Lifecycle and service | 10 | Are versioning, replacement, retirement, and migration credible? | /10 |
| Operational viability | 10 | Can it be produced, fulfilled, supported, and maintained responsibly? | /10 |
| **Total** | **100** |  | **/100** |

## Mandatory Questions

- Does it connect to an existing approved interface or have an explicit platform-service role?
- Does it create a useful new capability?
- Does it preserve familiar attachment behavior?
- Can the customer understand it without internal terminology?
- Does it work in at least one complete Starter Kit or expansion path?
- Is another Zone or module reuse case credible rather than invented?
- Is it visually related without being a copy?
- Is the collection value more than a color change?
- Are material and environment boundaries honest?
- Can service continue after an edition ends?
- Does it improve the catalog rather than make choice harder?
- Would the product still be approved without a campaign story?

## Automatic Rejection Conditions

- Breaks backward compatibility without an approved migration path
- Relies on unvalidated wet, heat, load, food-contact, child-safety, or third-party-fit claims
- Exists only to imitate LEGO or another recognizable brand code
- Hides a necessary function behind random or artificial scarcity
- Has no distinct job compared with an active SKU
- Cannot state its Base class and interface generation
- Requires support or replacement the organization cannot provide
- Makes the current Starter Kit feel intentionally incomplete
- Uses color-only duplication to claim product innovation
- Has no owner or evidence-review date

## Decision Record

```text
Product proposal:
Primary role:
Customer job:
Evidence references:
Hard-gate result:
Score:
Decision: PASS / PASS WITH REVISION / REJECT
Required revisions:
Compatibility owner:
Brand owner:
Product owner:
Review date:
Retirement trigger:
```
