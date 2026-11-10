import 'server-only'
import { createHash, randomBytes } from 'node:crypto'
import postgres from 'postgres'

export const LOCAL_SESSION_COOKIE = 'funtastic_session'
let client: ReturnType<typeof postgres> | undefined
export function authDatabase() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('Independent authentication database is not configured')
  return client ??= postgres(url, { max: 2, prepare: false, idle_timeout: 20 })
}
const digest = (token: string) => createHash('sha256').update(token).digest('hex')

export async function createLocalSession(userId: string) {
  const sql = authDatabase()
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  const rows = await sql`
    INSERT INTO app_auth_sessions(token_hash, user_id, expires_at)
    SELECT ${digest(token)}, a.user_id, ${expiresAt}
    FROM app_auth_accounts a JOIN user_profiles p ON p.id = a.user_id
    WHERE a.user_id = ${userId}::uuid AND a.approval_status = 'approved'
      AND p.deactivated_at IS NULL
    RETURNING user_id
  `
  if (!rows.length) throw new Error('Account is not approved')
  return { token, expiresAt }
}

export async function validateLocalSession(token?: string) {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null
  const sql = authDatabase()
  const [row] = await sql`
    SELECT a.user_id::text AS id
    FROM app_auth_sessions s JOIN app_auth_accounts a ON a.user_id = s.user_id
    JOIN user_profiles p ON p.id = a.user_id
    WHERE s.token_hash = ${digest(token)} AND s.expires_at > now()
      AND a.approval_status = 'approved' AND p.deactivated_at IS NULL
  `
  return row ? { id: String(row.id), mustChangePassword: false } : null
}

export async function revokeLocalSession(token: string) {
  const sql = authDatabase()
  await sql`DELETE FROM app_auth_sessions WHERE token_hash = ${digest(token)}`
}
