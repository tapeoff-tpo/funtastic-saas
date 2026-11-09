// Vercel provides the environment-scoped DB connection. Prepare additive schema
// before the new application is promoted, without copying production secrets locally.
if (process.env.VERCEL === '1') {
  await import('./migrate-admin-menu-permissions.mjs')
  await import('./migrate-purchase-inspection.mjs')
  await import('./migrate-inspection-outbound-packing.mjs')
  await import('./prepare-inventory-search.mjs')
}
