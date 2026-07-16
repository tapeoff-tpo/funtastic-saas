# FUN-TASTIC Opportunities Data Contract

## Source of truth

Sales, order count, marketplace fee, purchasing cost, shipping cost, box cost,
and calculated final profit reuse the SaaS product-profit analytics logic.

The default analysis window is the latest 12 completed calendar months.
`--include-current-month` may be used for an operational mid-month view, but
that result should not be compared directly with completed months.

## Evidence states

- `confirmed`: directly calculated from internal records.
- `strong-signal`: multiple indirect sources agree.
- `weak-signal`: a preliminary rule or single indirect source.
- `unverified`: evidence is absent.

Missing data must remain missing. It must not be replaced by a fabricated
market size, customer behavior, dimension, material, cost, or print time.

## Preliminary screening

Printability, upgrade potential, premium potential, and safety/legal screening
use editable keyword rules in `config/opportunity-scoring.json`. These scores
are research prioritization aids. They are not engineering approval, legal
clearance, or permission to create final CAD.

## Output lineage

Every run stores:

- analysis timestamp and data-through date
- workspace user ID
- scoring configuration version
- source snapshot
- ranked and excluded CSV files
- criterion-level evidence CSV
- missing-data report

The source snapshot may be used with `funtastic opportunities --input` to
reproduce an analysis without reconnecting to PostgreSQL.

When the local machine does not have `DATABASE_URL`, a signed-in SaaS user can
download the same aggregate snapshot from:

`/api/analytics/opportunities/source`

Optional query parameters:

- `asOf=YYYY-MM-DD`
- `includeCurrentMonth=1`
