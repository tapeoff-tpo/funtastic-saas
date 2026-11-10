import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { LOCAL_SESSION_COOKIE, validateLocalSession, revokeLocalSession, authDatabase } from '@/lib/auth/local-session'
import { hash } from 'bcryptjs'

export async function createClient() {
  const cookieStore = await cookies()

  const client = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {}
        },
      },
    }
  )
  if (process.env.AUTH_PROVIDER === 'local') {
    const localUser = async () => {
      const session = await validateLocalSession(cookieStore.get(LOCAL_SESSION_COOKIE)?.value)
      if (!session) return null
      const sql = authDatabase()
      const [profile] = await sql`SELECT email FROM app_auth_accounts WHERE user_id = ${session.id}::uuid`
      return { id: session.id, email: profile?.email, app_metadata: {}, user_metadata: {} }
    }
    Object.assign(client.auth, {
      updateUser: async ({ password }: { password: string }) => {
        const user = await localUser()
        if (!user) return { data: { user: null }, error: { message: '로그인이 필요합니다.' } }
        if (password.length<12 || Buffer.byteLength(password)>72) return { data: { user: null }, error: { message: '비밀번호는 12자 이상, 72바이트 이하여야 합니다.' } }
        const sql = authDatabase()
        await sql`UPDATE app_auth_accounts SET password_hash=${await hash(password,12)} WHERE user_id=${user.id}::uuid`
        await sql`DELETE FROM app_auth_sessions WHERE user_id=${user.id}::uuid AND token_hash <> ${await import('node:crypto').then(({createHash})=>createHash('sha256').update(cookieStore.get(LOCAL_SESSION_COOKIE)!.value).digest('hex'))}`
        return { data: { user }, error: null }
      },
      exchangeCodeForSession: async () => ({ data: { user: null, session: null }, error: { message: 'Supabase OAuth is disabled' } }),
      getUser: async () => ({ data: { user: await localUser() }, error: null }),
      getClaims: async () => { const user = await localUser(); return { data: user ? { claims: { sub: user.id, app_metadata: {} } } : null, error: null } },
      signOut: async () => {
        const token = cookieStore.get(LOCAL_SESSION_COOKIE)?.value
        if (token) await revokeLocalSession(token)
        cookieStore.delete(LOCAL_SESSION_COOKIE)
        return { error: null }
      },
    })
  }
  return client
}
