# Operational Job Lanes

These lanes must stay independent:

- `order`: order collection only.
- `invoice`: invoice/shipping upload only.
- `cs`: claim and inquiry collection only.

Rules:

1. A lane may block only another job in the same lane.
2. Order collection must not block invoice upload.
3. Order collection must not block CS/inquiry collection.
4. CS/inquiry collection must not block order collection.
5. Invoice upload must remain available while order or CS collection is running.
6. New marketplace integrations must not change lane locking unless the request is explicitly about this file.

Current lock implementation:

- `src/lib/jobs/collection-lock.ts` guards duplicate `order` and duplicate `cs` jobs.
- Invoice upload uses the separate `invoice-upload` queue and is intentionally excluded from collection locks.
