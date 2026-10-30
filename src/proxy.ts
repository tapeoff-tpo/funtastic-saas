import { NextResponse, type NextRequest } from 'next/server'
import { getProxyUser } from '@/lib/auth/proxy-user'
import { getUserMenuAccess } from '@/lib/auth/menu-access'
import { canAccessApi, canAccessPage } from '@/lib/auth/menu-permissions'
import {
  LOGIN_SESSION_MODE_COOKIE,
  LOGIN_SESSION_PROOF_COOKIE,
  hasExpiredManagedLoginSession,
} from '@/lib/auth/login-session'

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const supabaseResponse = NextResponse.next({
    request,
  })

  // Public endpoints do not need a remote auth lookup.
  const isSmsBridgeDeviceEndpoint =
    pathname === '/api/sms-bridge/pair'
    || pathname === '/api/sms-bridge/messages'
    || pathname === '/api/sms-bridge/heartbeat'
  // Figma plugins cannot send the browser's Supabase cookie. These routes
  // authenticate with a one-time pairing code or an opaque bridge token.
  const isFigmaBridgeEndpoint = pathname.startsWith('/api/operations/detail-pages/bridge/')
  // Figma loads image fills directly and cannot carry the SaaS auth cookie.
  // Detail-page assets are non-sensitive generated product images only.
  const isDetailPageAsset = pathname.startsWith('/detail-page-assets/')

  if (
    pathname === '/api/health'
    || pathname.startsWith('/api/debug/')
    || pathname.startsWith('/auth/callback')
    || isSmsBridgeDeviceEndpoint
    || isFigmaBridgeEndpoint
    || isDetailPageAsset
  ) {
    return supabaseResponse
  }

  const hasAuthCookie = request.cookies
    .getAll()
    .some((cookie) => cookie.name.startsWith('sb-') && cookie.name.includes('-auth-token'))

  if (!hasAuthCookie) {
    if (pathname === '/login') {
      return supabaseResponse
    }

    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  const sessionMode = request.cookies.get(LOGIN_SESSION_MODE_COOKIE)?.value
  const sessionProof = request.cookies.get(LOGIN_SESSION_PROOF_COOKIE)?.value
  if (hasExpiredManagedLoginSession(sessionMode, sessionProof)) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: '로그인 세션이 만료되었습니다. 다시 로그인해주세요.' },
        { status: 401 },
      )
    }

    if (pathname !== '/login') {
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      url.searchParams.set('reason', 'session_expired')
      return NextResponse.redirect(url)
    }
  }

  // Prevent caching of authenticated responses
  supabaseResponse.headers.set('Cache-Control', 'private, no-store')

  if (pathname !== '/login') {
    const user = await getProxyUser(request, supabaseResponse)
    const access = user ? await getUserMenuAccess(user.id) : null
    const isApi = pathname.startsWith('/api/')
    if (!access) {
      return isApi ? NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
        : NextResponse.redirect(new URL('/login', request.url))
    }
    const allowed = isApi ? canAccessApi(access, pathname, request.method) : canAccessPage(access, pathname)
    if (!allowed) {
      if (isApi || request.method !== 'GET') {
        return NextResponse.json({ error: '이 메뉴에 접근할 권한이 없습니다.' }, { status: 403, headers: { 'Cache-Control': 'private, no-store' } })
      }
      return NextResponse.redirect(new URL('/access-denied', request.url))
    }
    const next = NextResponse.next({ request: { headers: request.headers } })
    for (const cookie of supabaseResponse.cookies.getAll()) next.cookies.set(cookie)
    next.headers.set('Cache-Control', 'private, no-store')
    return next
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/auth).*)'],
}
