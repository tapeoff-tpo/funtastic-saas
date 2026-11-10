import { client as sql } from '@/lib/db'
import { hash } from 'bcryptjs'

export function createLocalAdmin() {
  async function getUserById(id: string) {
    const [row] = await sql`SELECT p.id::text,p.email,p.role,p.display_name,a.approval_status FROM user_profiles p LEFT JOIN app_auth_accounts a ON a.user_id=p.id WHERE p.id=${id}::uuid`
    return { data: { user: row ? { id: row.id, email: row.email, app_metadata: { role: row.role }, user_metadata: { full_name: row.display_name } } : null }, error: null }
  }
  return {
    auth: { admin: {
      getUserById,
      listUsers: async ({ page = 1, perPage = 1000 } = {}) => {
        const rows = await sql`SELECT id::text FROM user_profiles ORDER BY created_at LIMIT ${Math.min(perPage,1000)} OFFSET ${(page-1)*perPage}`
        const users = []
        for (const row of rows) { const result = await getUserById(String(row.id)); if (result.data.user) users.push(result.data.user) }
        return { data: { users }, error: null }
      },
      updateUserById: async (id: string, attributes: { password?: string; ban_duration?: string; app_metadata?: Record<string,unknown> }) => {
        if (attributes.password) {
          if (attributes.password.length < 12 || Buffer.byteLength(attributes.password)>72) return { data: { user: null }, error: { message: '비밀번호는 12자 이상, 72바이트 이하여야 합니다.' } }
          const passwordHash = await hash(attributes.password,12)
          await sql`UPDATE app_auth_accounts SET password_hash=${passwordHash} WHERE user_id=${id}::uuid`
          await sql`DELETE FROM app_auth_sessions WHERE user_id=${id}::uuid`
        }
        if (attributes.ban_duration) {
          await sql`UPDATE app_auth_accounts SET approval_status=${attributes.ban_duration==='none'?'approved':'blocked'} WHERE user_id=${id}::uuid`
          await sql`DELETE FROM app_auth_sessions WHERE user_id=${id}::uuid`
        }
        return getUserById(id)
      },
    } },
    rpc: async (name: string, args: Record<string,string>) => {
      let rows
      switch(name) {
        case 'store_marketplace_credential': rows=await sql`SELECT public.store_marketplace_credential(${args.p_name},${args.p_secret},${args.p_description ?? ''}) value`; break
        case 'read_marketplace_credential': rows=await sql`SELECT public.read_marketplace_credential(${args.p_name}) value`; break
        case 'delete_marketplace_credential': rows=await sql`SELECT public.delete_marketplace_credential(${args.p_name}) value`; break
        case 'update_marketplace_credential': rows=await sql`SELECT public.update_marketplace_credential(${args.p_name},${args.p_secret}) value`; break
        default: throw new Error('Unsupported database function')
      }
      return { data: rows[0]?.value ?? null, error: null }
    },
  }
}
