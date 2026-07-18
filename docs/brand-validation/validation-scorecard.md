# FUN-TASTIC Brand Validation Scorecard

Status: `not-run`

This file rolls up collected evidence. It contains no customer score, pass decision, or fabricated result.

## Status Vocabulary

- `not-run`: no participant evidence
- `pilot-only`: instrument tested; not decision-grade
- `evidence-collected`: decision test completed and quality checked
- `supported`: proposed success rule met
- `mixed`: material positive and negative evidence
- `not-supported`: proposed failure rule met
- `invalid`: design, sample, stimulus, or data-quality failure

These statuses are evidence labels, not GO/HOLD/KILL decisions.

## Hypothesis Roll-up

| ID | Hypothesis | Primary evidence | Positive evidence | Negative evidence | Result metric | Proposed rule met? | Evidence quality | Status |
|---|---|---|---|---|---|---|---|---|
| H1 | Platform understanding | Message and offer comprehension |  |  |  |  | none | not-run |
| H2 | Interface supports follow-up purchase | Interview and add-on choice |  |  |  |  | none | not-run |
| H3 | Starter Kit improves platform understanding | Randomized offer test |  |  |  |  | none | not-run |
| H4 | Attachment experience adds value | Concept probe; later physical test |  |  |  |  | none | not-run |
| H5 | Cross-Zone reuse lowers risk | Scenario and allocation task |  |  |  |  | none | not-run |
| H6 | Color and personalization support function | Collection trade-off test |  |  |  |  | none | not-run |
| H7 | Compatibility promise increases trust | Promise/control test |  |  |  |  | none | not-run |

## Instrument Readiness

| Component | Required artifact | Current state | Blocking issue |
|---|---|---|---|
| Segments | `validation-plan.md` | defined | Recruitment channels and quotas not selected |
| Interviews | `interview-guide.md` | ready for pilot | Moderator training and consent process required |
| Survey | `survey.md` | ready for programming | Survey platform and randomization QA required |
| Messages | `message-test.md` | text stimuli ready | Decision sample requires pilot and power calculation |
| Starter offers | `starter-kit-test.md` | neutral content defined | Equal-quality cards must be produced and QA checked |
| Collections | `collection-test.md` | task defined | Neutral controlled cards and any price input are missing |
| Results | `participant-results.csv` | header only | No participants |

## Evidence Quality Review

Complete after collection:

| Check | Result | Notes |
|---|---|---|
| Recruitment matches segment behavior |  |  |
| Consent and privacy requirements met |  |  |
| Randomization worked |  |  |
| Stimulus exposure was consistent |  |  |
| Primary outcomes were recorded unaided |  |  |
| Exclusions followed predeclared rules |  |  |
| Missing data reported |  |  |
| Pilot and decision data separated |  |  |
| Confidence intervals and effect sizes reported |  |  |
| Negative evidence preserved |  |  |

## Decision-Test Prerequisites

- Pilot completed
- Stimulus defects corrected
- Primary metric per hypothesis frozen
- Baseline and variance recorded
- Minimum meaningful effect approved by product owner
- Power calculation recorded
- Segment quotas and exclusion rules frozen
- Analysis plan timestamped before decision collection

## Current Phase Status

# ready-for-customer-test

This means the validation system is ready for pilot use. It does not mean the brand, message, Starter Kit, collection strategy, or compatibility promise is validated.
