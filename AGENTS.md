<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
## Project Critical Rules

### Collection Responsibility Policy

- All-market order collection must stay fast. `/orders/collect` is responsible only for collecting orders and moving eligible marketplace orders into order-confirmed/shipping-prep status.
- Do not add inquiry, claim, return-inspection, or unrelated CS collection work to the all-market order collection path.
- Marketplace inquiries must be collected from the dedicated CS inquiry collection button/page, not as a side effect of order collection.
- When adding or changing marketplace integrations, keep `getOrders` / order confirmation logic separate from `getInquiries` / CS claim logic so a slow CS endpoint cannot block daily order collection.

### Admin Account Policy

- Operational data is shared across all admin accounts.
- `admin123` is the canonical workspace owner and the source of truth for shared data.
- Other admin accounts exist only for login identity, permissions, and audit tracking.
- Switching accounts must not change visible business data.
- Orders, marketplace connections, products, inventory, mapping codes, mapping components, carrier templates, company settings, shipping data, and order-management settings must not become account-specific unless the user explicitly requests isolated workspaces.
- When adding queries or mutations for operational data, resolve the workspace owner with `getWorkspaceUserId(user.id)` before reading or writing user-scoped tables.

### Deployment

- Production is deployed on Railway from the GitHub `main` branch.
- After production fixes, run a production build when practical, commit changes, push to `origin main`, and verify the Railway URL responds.
