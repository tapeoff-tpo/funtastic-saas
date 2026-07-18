# Project FUN-TASTIC - Brand Validation Plan

Status: `ready-for-customer-test`

Checked: 2026-07-18

## 1. Purpose

This phase validates whether customers understand and value the Phase 7 brand system. It does not validate a finished product, visual identity, physical interface, price, or market size.

No participant response exists yet. All hypotheses remain `not-run`.

## 2. Source Material

- `docs/brand-operating-system/`
- `docs/universal-living-platform/`
- `docs/modular-interface-discovery/`
- `docs/pla-first-platform/`

## 3. Research Questions

1. Is FUN-TASTIC understood as an expandable platform rather than a single organizer?
2. Does compatibility create useful follow-up demand or proprietary-standard anxiety?
3. Does a Starter Kit communicate immediate and future value better than a Base or single product?
4. Is playful attachment valued as useful confirmation or rejected as extra work?
5. Does cross-Zone reuse lower purchase risk?
6. Do color and personalization support rather than replace function?
7. Is a long-term compatibility promise credible and valuable?

Hypothesis IDs and proposed decision rules are defined in `hypotheses.csv`.

## 4. Priority Segments

Segments are recruited by recent behavior, not demographic label alone. A participant may match multiple segments but receives one primary code based on the strongest behavior.

| ID | Segment | Inclusion behavior | Why included | Behavior to verify |
|---|---|---|---|---|
| S1 | Student organizers | Currently studies and bought or improvised a desk organizer within the last 12 months | Study is the first proposed Zone and budget or space may shape bundle acceptance | Desk clutter job, portability, color, price resistance, next module |
| S2 | Early-career workers | Works or hybrid-works and recently changed or purchased desk accessories | Work is the second proposed Zone and can reveal home-to-office transfer | Device docking, cable management, second-location reuse, professional appearance |
| S3 | Deskterior enthusiasts | Has deliberately coordinated desk appearance and bought at least two desk accessories in the last 12 months | Most likely to distinguish visual system from functional system | CMF value, social display, collection pull, rejection of toy-like styling |
| S4 | Repeat organizer buyers | Bought an organizer and later added, replaced, or abandoned another organizing product | Direct evidence of repeat, failure, and switching behavior | Why systems continue or stop, compatibility trust, forced-bundle resistance |
| S5 | Hobby and collection users | Organizes or displays tools, stationery, figures, cards, gaming, camera, craft, or beauty items | Object-specific long-tail and collection behavior are central to platform expansion | Fit needs, modular depth, completion versus utility, willingness to customize |

### Recruitment exclusions

- Employees or close project collaborators for primary evidence
- Participants who have not made or influenced an organizing purchase
- Duplicate participants across randomized cells
- Anyone unable to provide informed consent

Employees may be used only for instrument debugging and must be labeled separately.

## 5. Research Sequence

### Stage 0: Instrument and stimulus pilot

Purpose:

- Detect wording, translation, timing, and recording failures
- Confirm that cards differ only in the intended variable
- Establish baseline proportions and rating variance for power calculations

Proposed pilot:

- 8-12 observations per randomized message or offer cell
- 4-6 interviews per priority segment where feasible
- Pilot results are directional and cannot approve the brand strategy

These numbers are planning proposals, not decision-grade sample sizes.

### Stage 1: Non-leading interviews

Use `interview-guide.md`.

- Begin with recent actual behavior.
- Do not introduce “platform,” “universal,” or “compatibility” before unaided responses.
- Expose message and offer stimuli only after the behavior section.
- Preserve raw language before coding.

### Stage 2: Randomized comprehension tests

Use `message-test.md` and `starter-kit-test.md`.

- Primary metrics use one assigned condition per participant.
- Show a stimulus for the defined exposure time, remove it, then ask unaided questions.
- Do not show all alternatives before primary comprehension and trust measures.
- Secondary preference comparison may occur after primary measures are locked.

### Stage 3: Collection and continuation test

Use `collection-test.md`.

- Hold core function, price display, image quality, and item count constant where the hypothesis requires isolation.
- Require a constrained choice or simulated allocation, not ratings alone.
- Separate “looks good” from “would add next and why.”

### Stage 4: Behavioral validation, later

Only after low-fidelity tests identify viable wording and offer structure:

- Paid preorder or refundable deposit
- Real add-on selection
- Follow-up module reminder or waitlist click
- Actual second order after a Starter Kit pilot

No behavioral result is created in this phase.

## 6. Stimulus Set

The validation system defines neutral test content; it does not create product design.

### S01 Brand message card

- One of messages A-D only
- Same type size, placement, duration, and background
- No logo, product render, or color treatment in the primary comprehension test

### S02 Platform explanation card

- Text: “하나의 Base에 필요한 모듈을 연결하고, 같은 연결 방식을 다른 생활 공간에서도 사용하는 정리 플랫폼입니다.”
- Schematic labels only: Base, Module, Add, Move
- Used after unaided message comprehension, never before it

### S03 Offer cards

- Single Organizer
- Base Only
- Desk Starter Kit
- Universal Starter Kit
- Same card dimensions, information hierarchy, illustration style, and disclosure level

Detailed content is in `starter-kit-test.md`.

### S04 Zone expansion card

- Study, Work, Bedroom, Living Room, Beauty
- Shows module-family reuse concept, not one physical Base in every environment
- Bathroom, wet Kitchen, heat, and high-load uses are excluded

### S05 Module-purchase flow

`Starter Kit -> new job -> compatible module -> optional second Base -> another Zone`

- Does not promise that a customer will follow the flow
- Used to test understanding after unaided responses

### S06 Color comparison

- Function and module count remain identical
- Neutral, pastel, and vivid families shown with equal visual quality
- Color names and exact standards remain placeholders until CMF development

### S07 Package-information wireframe

- Current job
- Included items
- Interface generation placeholder
- Compatible Base class
- Environment limits
- Attach / confirm / remove
- One adjacent module

No package graphics or logo are produced.

## 7. Sample and Statistical Rules

- Pilot sizes above are proposed for instrument debugging only.
- Decision sample sizes remain `TBD` until the pilot supplies baseline rate, variance, attrition, and a management-approved minimum meaningful effect.
- A power calculation must be recorded before the decision test.
- Segment quotas, confidence level, power, and multiple-comparison handling must be predeclared.
- Qualitative saturation is tracked by new-theme occurrence; it is not declared automatically at a fixed interview count.
- Report confidence intervals and effect sizes, not only p-values or averages.
- Do not merge pilot and decision data unless the instrument and analysis were unchanged and the merge was predeclared.

## 8. Analysis Rules

### Qualitative

- Preserve raw response in `participant-results.csv`.
- Code unaided response before viewing ratings or later answers.
- Use codes: `platform-correct`, `organizer-only`, `electronic-connection`, `single-base-everywhere`, `unclear`, `other`.
- Record positive and negative evidence.
- A second coder should review ambiguous or decision-critical responses where feasible.

### Quantitative

- Primary measures are defined before data collection.
- Compare randomized cells on comprehension, trust, differentiation, curiosity, and choice.
- Analyze segment interactions only when sample size supports them.
- Ratings never replace the behavioral proxy or unaided explanation.
- Missing responses and exclusions are reported rather than silently removed.

## 9. Bias Controls

- Ask recent behavior before future intention.
- Avoid “Would you like...” wording.
- Randomize message and offer assignment.
- Keep visual quality and information volume consistent.
- Do not reveal the preferred internal concept.
- Separate researcher explanation from the tested stimulus.
- Do not describe a proprietary standard as guaranteed for ten years.
- Record when the participant already owns a modular system.

## 10. Data and Privacy

- Use an anonymous participant ID.
- Store consent separately from research responses.
- Do not place names, phone numbers, emails, or addresses in `participant-results.csv`.
- Restrict raw recordings and transcripts according to company policy.
- Record recruitment incentives and conflicts.
- Obtain explicit permission before audio, video, or image recording.

## 11. Deliverables and Ownership

| File | Purpose | Must remain empty until research? |
|---|---|---|
| `hypotheses.csv` | Hypotheses and proposed decision rules | Result column yes |
| `interview-guide.md` | Non-leading qualitative protocol | No |
| `survey.md` | Structured measurement instrument | Response data yes |
| `message-test.md` | Message experiment | Result section yes |
| `starter-kit-test.md` | Offer experiment | Result section yes |
| `collection-test.md` | Continuation experiment | Result section yes |
| `participant-results.csv` | Normalized observation log | All data rows yes |
| `validation-scorecard.md` | Evidence roll-up | Scores and verdicts yes |
| `evidence-gaps.md` | Known missing evidence | No |

## 12. Current Status

# ready-for-customer-test

The instruments and neutral low-fidelity content definitions are ready for a pilot. This status does not mean any hypothesis passed. Decisive quantitative testing remains blocked until pilot estimates and power calculations are completed.
