import { NextResponse, type NextRequest } from 'next/server'

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

  // Prevent caching of authenticated responses
  supabaseResponse.headers.set('Cache-Control', 'private, no-store')

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/auth).*)'],
}
