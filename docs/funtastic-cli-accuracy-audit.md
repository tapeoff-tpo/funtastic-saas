# FUN-TASTIC CLI Accuracy Audit

> Historical note: this audit describes Discover before Evidence Builder 2.0.
> See `docs/funtastic-discover-evidence.md` for the current Discover contract.

Audited commit: `69a5191`

Audit date: 2026-07-17

## Executive Result

| Command | Status | Reason |
|---|---|---|
| `opportunities` | Partial operation | Real internal data ingestion and reporting work; FDM/premium ranking remains keyword screening and empty input is accepted as success |
| `discover` | Template level | Reads the internal snapshot and official Funtastic B2B API, but performs no domestic/international market, review, VOC, or competitor research |
| `concepts` | Template level | Validates and reformats a manually authored `concepts-input.json`; it does not derive concepts from discovery reports |
| `council` | Template level | Calls local document functions, not Agents; decision and kitchen/dishcloth language are hardcoded |

## Actual Input Lineage

### opportunities

- `--input PATH`: reads a local JSON snapshot directly.
- Default mode: requires `DATABASE_URL` and queries PostgreSQL through
  `loadOpportunitySource`.
- Database source combines product-profit analytics, product master/options,
  inventory, return claims, stockout events, and a derived repeat-buyer rate.
- The signed-in SaaS snapshot API exists separately; the CLI does not call it.

### discover

- Reads `opportunities/current/source_snapshot.json` by default or `--snapshot`.
- Selects one exact internal SKU.
- Searches only `https://www.funtasticb2b.com/api/products` and its detail API.
- Downloads official B2B images.
- Creates empty research, strategy, CMF, manufacturing, and review templates.
- It does not search marketplaces, reviews, communities, social media, patents,
  premium brands, or VOC.

### concepts

- Reads only `products/<SKU>/concepts/concepts-input.json`.
- Does not read discovery, VOC, competitor, strategy, source, or Opportunity files.
- Requires at least five manually supplied concepts with distinct customer-value
  strings, assumptions, risks, and numeric scores.
- Generates Markdown packages and a scorecard from that supplied content.

### council

- Reads internal product JSON, B2B product JSON, and `concepts-input.json`.
- Counts rows in `review-evidence.csv` and counts URL strings in discovery Markdown.
- Does not semantically analyze the discovery documents or generated concepts.
- Does not call ChatGPT, Codex, an LLM API, MCP, or independent Agent processes.
- Generates all Agent reports with fixed local functions.

## Real-Data Execution

Input: private SaaS snapshot captured through 2026-06-30.

Observed execution:

```text
Analyzed products: 1826
Eligible products: 1696
Excluded products: 130
Generated files: 16
```

The command processed real internal data successfully. The automated top three
were the desktop stand, accordion file organizer, and wire book stand. Physical
review had already found these poor FDM candidates, proving that the structural
ranking is not yet product-accurate.

## End-to-End SKU Test

Test SKU: `101518-0001` (holding hook), deliberately different from CoCoHoldi.

### discover

```text
B2B match: 홀딩 후크 (2d8f84e2-dafb-4bc0-881c-1)
Source images: 5
```

The internal source, monthly CSV, official B2B JSON, and images were generated.
Market and VOC files remained empty templates.

### concepts

Without a manually created `concepts-input.json`:

```text
ERROR: ENOENT ... concepts/concepts-input.json
EXIT=1
```

After supplying five audit concepts manually, the command produced five packages
and a comparison. This validates transformation, not automatic concept creation.

### council

The holding-hook run still emitted statements about sinks, wet cloths, kitchen
integration, bundle accounting, and an April financial anomaly. It always printed:

```text
Decision: PASS WITH REVISION
CAD allowed: NO
```

This confirms CoCoHoldi-specific hardcoding and a fixed Gate outcome.

## Failure Matrix

| Condition | Observed behavior |
|---|---|
| No `DATABASE_URL` and no `--input` | Fails with exit 1 and an actionable error |
| Snapshot with zero products | Succeeds with exit 0 and empty reports; no empty-data failure gate |
| Missing snapshot file | Fails with filesystem error |
| Missing SKU in snapshot | Fails with exit 1 and SKU/path message |
| No external B2B result | `discover` succeeds and writes `status: not-found` plus templates |
| B2B/network failure | Warning; `discover` continues with no external product |
| Missing discovery documents | `concepts` is unaffected because it never reads them |
| Missing `concepts-input.json` | `concepts` fails with filesystem error |
| Missing council prerequisite | `council` fails at the first missing JSON/CSV file |
| Existing opportunity output | `current/` is deleted and replaced; timestamped `runs/` are retained |
| Existing discovery output | source JSON/CSV are overwritten; authored template files are preserved |
| Existing concepts output | generated concept files and scorecard are overwritten; no history |
| Existing council output | reports are overwritten; no run history |

## Cross-Stage Integrity

The full chain is not yet a true dependency chain:

```text
opportunities source snapshot -> discover source package
manual concepts-input.json    -> concepts output
manual concepts-input.json    -> council output
```

`concepts` bypasses discovery findings. `council` bypasses the generated concept
documents and most discovery content. Editing a discovery conclusion does not
change concept generation, and only URL/row counts can affect council context.

## Fresh Clone Reproduction

Environment: clean clone of GitHub `main` at `69a5191`, macOS, Node 22.

```text
npm ci: success, 937 packages installed in 11 seconds
CLI help: success
Real snapshot run: 1,826 products, 16 files
Git worktree after run: clean
```

`npm ci` reported 25 dependency vulnerabilities: 1 low, 15 moderate, and 9 high.
These did not block the CLI smoke test but require a separate dependency audit.

## Required Corrections

1. Add schema validation and reject an empty Opportunity dataset unless explicitly allowed.
2. Replace keyword-only physical screening with verified dimensions, material,
   process, build-envelope, load, and environment evidence.
3. Implement real research connectors or clearly rename `discover` to `scaffold`.
4. Make `concepts` consume discovery and strategy artifacts or clearly rename it
   to `render-concept-input`.
5. Replace fixed council functions with the registered FUN-TASTIC OS Agent engine,
   stage-aware prompts, evidence citations, and a computed Gate decision.
6. Add run history and provenance hashes for concepts and council outputs.
7. Add Linux and Windows CI coverage.
