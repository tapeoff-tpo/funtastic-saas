# Stable Marketplace Integrations

These integrations are confirmed working and should be treated as stable:

- Ownerclan: `src/lib/marketplace/adapters/ownerclan/README.md`
- 10x10: `src/lib/marketplace/adapters/10x10/README.md`

When a stable integration needs more work:

1. Read that marketplace's `README.md` first.
2. Isolate the change to the marketplace's own adapter/client/status/types files and only the already documented worker branches.
3. Do not mix stable integration changes with a new marketplace integration in the same commit.
4. After the fix is verified in production, update the marketplace `README.md` with the new stable baseline commit and any new gotchas.
5. Commit and push the updated implementation plus the refreshed stable note.

Manual collection window:

- Manual collection defaults to 3 days.
- The UI can send 1, 3, 6, 9, or 14 days for manual collection.
- The UI can also send a custom `manualDateFrom`/`manualDateTo` date range.
- The API clamps preset manual collection to 1 through 14 days and rejects custom date ranges longer than 14 days.
- Scheduled/background collection uses the worker default 7-day lookback.
- Ownerclan still queries that selected lookback in smaller API windows internally to avoid timeouts.

Order collection range workflow:

- The shared order collector splits long collection periods into 1-day ranges.
- Range-aware adapters receive both `since` and `until`.
- Range-aware adapters are collected with capped parallelism, currently 2 ranges at a time.
- Ownerclan and Naver are exceptions and are capped at 1 range at a time because their APIs return rate-limit errors under parallel load.
- The shared collector upserts every fetched order, including orders already saved locally, so later collection can backfill missed orders and refresh marketplace status/raw data.
- Existing orders only refresh order header/status/raw data during collection; order item replacement is reserved for newly inserted orders to keep large reconciliation runs from stalling in the save step.
- Adapters that cannot safely pass `until` to the marketplace API must not be added to `RANGE_AWARE_ORDER_MARKETPLACES`, because repeated `since -> now` calls would create duplicated work and extra rate-limit pressure.
- Current range-aware order adapters: Ownerclan, 10x10, Coupang, Cafe24, Naver, Toss Shopping, 11st, ESM, Ably, Ohouse, Onchannel, SSG Mall, CJ OnStyle, Kakao Gift, Kakao Store.
- Domeggook is not listed here because its current private API implementation already slices by relative day internally, not by an exact `since`/`until` pair.
