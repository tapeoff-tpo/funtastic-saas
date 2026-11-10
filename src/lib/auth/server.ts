import { cookies } from 'next/headers'
import { createHash } from 'node:crypto'
import { hash } from 'bcryptjs'
import { LOCAL_SESSION_COOKIE, validateLocalSession, revokeLocalSession, authDatabase } from './local-session'

/** Menu and API authentication uses Aiven sessions only. */
export async function createClient() {
  const store = await cookies()
  const current = async () => {
    const session = await validateLocalSession(store.get(LOCAL_SESSION_COOKIE)?.value)
    if (!session) return null
    const sql = authDatabase()
    const [profile] = await sql`SELECT email FROM app_auth_accounts WHERE user_id=${session.id}::uuid`
    return { id: session.id, email: String(profile.email), app_metadata: {} as Record<string,unknown>, user_metadata: {} as Record<string,unknown> }
  }
  return { auth: {
    getUser: async () => ({ data: { user: await current() }, error: null }),
    getClaims: async () => { const user=await current(); return { data:user ? { claims:{sub:user.id,app_metadata:user.app_metadata} }:null,error:null } },
    signOut: async () => { const token=store.get(LOCAL_SESSION_COOKIE)?.value; if(token)await revokeLocalSession(token);store.delete(LOCAL_SESSION_COOKIE);return {error:null} },
    exchangeCodeForSession: async (_code: string) => ({error:{message:'External OAuth is not enabled'}}),
    updateUser: async ({password}:{password:string}) => {
      const user=await current()
      if(!user)return {error:{message:'로그인이 필요합니다.'}}
      if(password.length<12||Buffer.byteLength(password)>72)return {error:{message:'비밀번호는 12자 이상, 72바이트 이하여야 합니다.'}}
      const sql=authDatabase(), passwordHash=await hash(password,12)
      const tokenHash=createHash('sha256').update(store.get(LOCAL_SESSION_COOKIE)!.value).digest('hex')
      await sql.begin(async tx=>{
        await tx.unsafe('UPDATE app_auth_accounts SET password_hash=$1 WHERE user_id=$2::uuid',[passwordHash,user.id])
        await tx.unsafe('DELETE FROM app_auth_sessions WHERE user_id=$1::uuid AND token_hash<>$2',[user.id,tokenHash])
      })
      return {error:null}
    },
  } }
}
