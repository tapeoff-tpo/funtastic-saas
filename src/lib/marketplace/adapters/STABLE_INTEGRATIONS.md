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

Ownerclan current collection window:

- Manual collection defaults to 3 days.
- The UI can send 1, 3, 6, 9, or 14 days for Ownerclan manual collection.
- The API clamps Ownerclan manual collection to 1 through 14 days.
- Scheduled/background collection uses the worker default 7-day lookback.
- Ownerclan still queries that selected lookback in smaller API windows internally to avoid timeouts.
