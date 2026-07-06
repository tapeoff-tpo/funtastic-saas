import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { readCredential, storeCredential } from '@/lib/supabase/admin'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'

const DEFAULT_APP_URL = 'https://funtastic-saas-vercel.vercel.app'
const REDIRECT_URI = `${process.env.NEXT_PUBLIC_APP_URL ?? DEFAULT_APP_URL}/api/cafe24/callback`

/**
 * Cafe24 OAuth callback — automatically exchanges the authorization code
 * for access_token + refresh_token and saves them to Supabase Vault.
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  const error = req.nextUrl.searchParams.get('error')

  if (error) {
    return html(`<h2 style="color:red">오류</h2><p>${error}</p>`)
  }

  if (!code) {
    return html(`<h2>code 없음</h2><p>Cafe24 OAuth 플로우를 통해 접근해주세요.</p>`)
  }

  // Get the logged-in user
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return html(`<h2 style="color:red">로그인 필요</h2><p>먼저 로그인해주세요.</p>`)
  }

  const workspaceUserId = await getWorkspaceUserId(user.id)

  // Read client_id, client_secret, mall_id from vault
  let clientId: string | null = null
  let clientSecret: string | null = null
  let mallId: string | null = null

  try {
    ;[clientId, clientSecret, mallId] = await Promise.all([
      readCredential('cafe24', workspaceUserId, 'client_id'),
      readCredential('cafe24', workspaceUserId, 'client_secret'),
      readCredential('cafe24', workspaceUserId, 'mall_id'),
    ])
  } catch (err) {
    return html(`<h2 style="color:red">Vault 읽기 실패</h2><p>${err instanceof Error ? err.message : '알 수 없는 오류'}</p>`)
  }

  if (!clientId || !clientSecret || !mallId) {
    return html(`<h2 style="color:red">인증정보 없음</h2><p>먼저 설정 페이지에서 Cafe24 client_id, client_secret, mall_id를 등록해주세요.</p>`)
  }

  // Exchange authorization code for tokens
  let tokenData: { access_token: string; refresh_token: string; expires_at?: number } | null = null

  try {
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
    const tokenRes = await fetch(`https://${mallId}.cafe24api.com/api/v2/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${credentials}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
      }).toString(),
    })

    if (!tokenRes.ok) {
      const body = await tokenRes.text()
      return html(`<h2 style="color:red">토큰 교환 실패 (${tokenRes.status})</h2><pre>${body}</pre>`)
    }

    tokenData = await tokenRes.json()
  } catch (err) {
    return html(`<h2 style="color:red">토큰 요청 오류</h2><p>${err instanceof Error ? err.message : '알 수 없는 오류'}</p>`)
  }

  if (!tokenData?.access_token) {
    return html(`<h2 style="color:red">access_token 없음</h2><pre>${JSON.stringify(tokenData, null, 2)}</pre>`)
  }

  // Save access_token and refresh_token to vault
  try {
    await Promise.all([
      storeCredential('cafe24', workspaceUserId, 'access_token', tokenData.access_token),
      tokenData.refresh_token
        ? storeCredential('cafe24', workspaceUserId, 'refresh_token', tokenData.refresh_token)
        : Promise.resolve(),
    ])
  } catch (err) {
    return html(`<h2 style="color:red">Vault 저장 실패</h2><p>${err instanceof Error ? err.message : '알 수 없는 오류'}</p>`)
  }

  // Success — redirect to settings page using the configured public Vercel URL.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? DEFAULT_APP_URL
  return NextResponse.redirect(`${appUrl}/settings/marketplaces?cafe24=token_updated`)
}

function html(body: string) {
  return new NextResponse(
    `<html><body style="font-family:monospace;padding:40px;background:#f5f5f5">${body}</body></html>`,
    { headers: { 'Content-Type': 'text/html' } },
  )
}
