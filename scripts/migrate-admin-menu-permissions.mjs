import { readFile } from 'node:fs/promises'
import postgres from 'postgres'

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL이 필요합니다.')
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 })
try {
  const migration = await readFile(new URL('../supabase/migrations/20261030000000_admin_menu_permissions.sql', import.meta.url), 'utf8')
  await sql.unsafe(migration)
  const [table] = await sql`SELECT rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename = 'user_menu_permissions'`
  if (!table?.rowsecurity) throw new Error('메뉴 권한 테이블과 RLS를 확인해주세요.')
  const [audit] = await sql`SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'audit_action' AND e.enumlabel = 'account.menu_permissions_change'`
  if (!audit) throw new Error('권한 변경 감사 이력 형식을 확인해주세요.')
  console.log('메뉴 권한 테이블·RLS·감사 이력 준비 완료. 기존 계정 권한은 변경하지 않았습니다.')
} finally { await sql.end() }
