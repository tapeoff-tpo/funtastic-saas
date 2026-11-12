'use server'
import { compare } from 'bcryptjs'
import { createHash } from 'node:crypto'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { authDatabase, createLocalSession, LOCAL_SESSION_COOKIE } from '@/lib/auth/local-session'

export async function login(formData: FormData) {
  const email=String(formData.get('email') ?? '').trim().toLowerCase()
  const password=String(formData.get('password') ?? '')
  const sql=authDatabase()
  const [limit]=await sql`INSERT INTO app_auth_login_limits(email_hash) VALUES(${createHash('sha256').update(email).digest('hex')}) ON CONFLICT(email_hash) DO UPDATE SET attempts=CASE WHEN app_auth_login_limits.window_start<now()-interval '15 minutes' THEN 1 ELSE app_auth_login_limits.attempts+1 END,window_start=CASE WHEN app_auth_login_limits.window_start<now()-interval '15 minutes' THEN now() ELSE app_auth_login_limits.window_start END RETURNING attempts`
  if(Number(limit.attempts)>10)return {error:'로그인 시도가 많습니다. 15분 후 다시 시도해주세요.'}
  const [account]=await sql`SELECT user_id::text,password_hash FROM app_auth_accounts WHERE lower(email)=${email} AND approval_status='approved'`
  if(!account?.password_hash || !await compare(password,String(account.password_hash)))return {error:'로그인 정보가 올바르지 않거나 비밀번호 설정·승인이 필요합니다.'}
  const {token,expiresAt}=await createLocalSession(String(account.user_id))
  ;(await cookies()).set(LOCAL_SESSION_COOKIE,token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/',expires:expiresAt})
  redirect('/dashboard')
}
