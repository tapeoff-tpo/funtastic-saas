import { createServerClient } from '@supabase/ssr'
import type { NextRequest, NextResponse } from 'next/server'

/** Proxy has its own request context: use request.cookies, not next/headers. */
export async function getProxyUser(request: NextRequest, response: NextResponse): Promise<{ id: string } | null> {
  const client = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookies) => {
        for (const { name, value, options } of cookies) {
          request.cookies.set(name, value)
          response.cookies.set(name, value, options)
        }
      },
    },
  })
  const { data } = await client.auth.getClaims()
  return typeof data?.claims?.sub === 'string' ? { id: data.claims.sub } : null
}
