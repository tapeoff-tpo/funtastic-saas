// Vercel provides the environment-scoped DB connection. Prepare additive schema
// before the new application is promoted, without copying production secrets locally.
if (process.env.VERCEL === '1') {
  await import('./migrate-admin-menu-permissions.mjs')
}
