/**
 * One-time staff account bootstrap.
 *
 * Creates auth.users entries via Supabase Admin API (service_role).
 * Role assignment is stashed in app_metadata.role and display_name in user_metadata,
 * so when Phase 9 ships and user_profiles is created, a backfill can populate it.
 *
 * Idempotent: if a user with the same email already exists, it is skipped (not modified).
 *
 * Usage (from project root):
 *   node --env-file=.env.local scripts/create-staff-accounts.mjs
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const INITIAL_PASSWORD = process.env.INITIAL_USER_PASSWORD ?? 'eksrnr2125@'

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

/** @type {{ email: string, name: string, role: 'super_admin' | 'admin' }[]} */
const accounts = [
  { email: 'belload89@gmail.com',     name: '오너',      role: 'super_admin' },
  { email: 'ian@tapeoff.kr',          name: '한상철',     role: 'admin' },
  { email: 'bob@tapeoff.kr',          name: '김기환',     role: 'admin' },
  { email: 'joshua@tapeoff.kr',       name: '최종석',     role: 'admin' },
  { email: 'parkjinwoo@tapeoff.kr',   name: '박진우',     role: 'admin' },
  { email: 'ohjieun@tapeoff.kr',      name: '오지은',     role: 'admin' },
  { email: 'ksh@tapeoff.kr',          name: '김소희',     role: 'admin' },
  { email: 'choikiwoong@tapeoff.kr',  name: '최기웅',     role: 'admin' },
  { email: 'phb@tapeoff.kr',          name: '박현빈',     role: 'admin' },
  { email: 'ljh@tapeoff.kr',          name: '이준호',     role: 'admin' },
]

async function findExisting(email) {
  // Supabase admin listUsers is paginated; for our small list, pages of 1000 is enough.
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (error) throw error
  return data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
}

async function main() {
  const results = []

  for (const acc of accounts) {
    const existing = await findExisting(acc.email)

    if (existing) {
      results.push({ email: acc.email, status: 'skipped (already exists)', id: existing.id })
      continue
    }

    const { data, error } = await admin.auth.admin.createUser({
      email: acc.email,
      password: INITIAL_PASSWORD,
      email_confirm: true, // skip email verification — internal accounts
      app_metadata: { role: acc.role },
      user_metadata: { display_name: acc.name },
    })

    if (error) {
      results.push({ email: acc.email, status: `error: ${error.message}` })
      continue
    }

    results.push({
      email: acc.email,
      status: 'created',
      role: acc.role,
      id: data.user.id,
    })
  }

  console.log('\n=== Account creation results ===\n')
  for (const r of results) {
    const icon = r.status === 'created' ? '✓' : r.status.startsWith('skipped') ? '○' : '✗'
    console.log(`${icon} ${r.email.padEnd(28)} ${r.status}${r.role ? `  [${r.role}]` : ''}`)
  }

  const created = results.filter((r) => r.status === 'created').length
  const skipped = results.filter((r) => r.status.startsWith('skipped')).length
  const failed = results.filter((r) => r.status.startsWith('error')).length
  console.log(`\nTotal: ${results.length}  Created: ${created}  Skipped: ${skipped}  Failed: ${failed}`)
  console.log(`\nInitial password (all accounts): ${INITIAL_PASSWORD}`)
  console.log('\nWhen Phase 9 ships, run a backfill to populate user_profiles from app_metadata.role.\n')

  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error('Fatal:', e)
  process.exit(1)
})
