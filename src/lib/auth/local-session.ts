import 'server-only'
import { createHash, randomBytes } from 'node:crypto'
import { client } from '@/lib/db'
import { cache } from 'react'
import { keepDatabaseAliveUntilIdle } from '@/lib/db/connection-lifecycle'
import type { MenuAccess } from './menu-permissions'

export type SessionAuthorization = {
  deactivatedAt: null
  email: string
  access: MenuAccess
}

export const LOCAL_SESSION_COOKIE = 'funtastic_session'
export function authDatabase() {
  keepDatabaseAliveUntilIdle()
  return client
}
const digest = (token: string) => createHash('sha256').update(token).digest('hex')

export async function createLocalSession(userId: string) {
  const sql = authDatabase()
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  const rows = await sql`
    INSERT INTO app_auth_sessions(token_hash, user_id, expires_at)
    SELECT ${digest(token)}, a.user_id, ${expiresAt.toISOString()}::timestamptz
    FROM app_auth_accounts a JOIN user_profiles p ON p.id = a.user_id
    WHERE a.user_id = ${userId}::uuid AND a.approval_status = 'approved'
      AND p.deactivated_at IS NULL
    RETURNING user_id
  `
  if (!rows.length) throw new Error('Account is not approved')
  return { token, expiresAt }
}

export const validateLocalSession = cache(async (token?: string) => {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null
  const sql = authDatabase()
  const [row] = await sql`
    SELECT a.user_id::text AS id, a.email, p.email AS "profileEmail", p.role,
      m.allowed_menus AS "allowedMenus", m.can_delete_purchases AS "canDeletePurchases"
    FROM app_auth_sessions s JOIN app_auth_accounts a ON a.user_id = s.user_id
    JOIN user_profiles p ON p.id = a.user_id
    LEFT JOIN user_menu_permissions m ON m.user_id = p.id
    WHERE s.token_hash = ${digest(token)} AND s.expires_at > now()
      AND a.approval_status = 'approved' AND p.deactivated_at IS NULL
  `
  if (!row) return null
  const authorization: SessionAuthorization = {
    deactivatedAt: null,
    email: String(row.profileEmail),
    access: {
      superAdmin: row.role === 'super_admin',
      allowedMenus: row.allowedMenus ?? null,
      canDeletePurchases: row.canDeletePurchases ?? false,
    },
  }
  return { id: String(row.id), email: String(row.email), mustChangePassword: false, authorization }
})

export async function revokeLocalSession(token: string) {
  const sql = authDatabase()
  await sql`DELETE FROM app_auth_sessions WHERE token_hash = ${digest(token)}`
}
