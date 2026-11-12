import { createHash } from 'node:crypto'
import { hash } from 'bcryptjs'
import { authDatabase } from '@/lib/auth/local-session'

export async function POST(request: Request) {
  const base = new URL(request.url)
  if (request.headers.get('origin') !== base.origin) return new Response('Forbidden', { status: 403 })
  const form = await request.formData()
  const token = String(form.get('token') ?? '')
  const password = String(form.get('password') ?? '')
  if (!/^[A-Za-z0-9_-]{43}$/.test(token) || password.length < 12 || Buffer.byteLength(password) > 72 || password !== form.get('confirm')) return Response.redirect(new URL('/set-password?error=1', base), 303)
  const sql = authDatabase()
  const passwordHash = await hash(password, 12)
  const changed = await sql.begin(async tx => {
    const [row] = await tx.unsafe('UPDATE app_auth_password_tokens SET consumed_at = now() WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now() RETURNING user_id::text', [createHash('sha256').update(token).digest('hex')])
    if (!row) return false
    await tx.unsafe('UPDATE app_auth_accounts SET password_hash = $1 WHERE user_id = $2::uuid', [passwordHash, row.user_id])
    await tx.unsafe('DELETE FROM app_auth_sessions WHERE user_id = $1::uuid', [row.user_id])
    return true
  })
  return Response.redirect(new URL(changed ? '/login?password_set=1' : '/set-password?error=1', base), 303)
}
