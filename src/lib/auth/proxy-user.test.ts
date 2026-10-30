import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { getProxyUser } from './proxy-user'

type CookieAdapter = { getAll: () => Array<{ name: string; value: string }>; setAll: (cookies: Array<{ name: string; value: string; options?: { httpOnly?: boolean } }>) => void }
const mocks = vi.hoisted(() => ({ claims: vi.fn(), adapter: null as CookieAdapter | null }))
vi.mock('@supabase/ssr', () => ({ createServerClient: (_url: unknown, _key: unknown, options: { cookies: CookieAdapter }) => {
  mocks.adapter = options.cookies
  return { auth: { getClaims: mocks.claims } }
} }))
describe('Proxy identity validation', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.adapter = null })
  it('uses the Proxy request cookie adapter and verifies claims', async () => {
    mocks.claims.mockResolvedValue({ data: { claims: { sub: 'verified-staff-id' } } })
    const request = new NextRequest('https://app.example/orders', { headers: { cookie: 'sb-test-auth-token=cookie-value' } })
    const response = NextResponse.next()
    expect(await getProxyUser(request, response)).toEqual({ id: 'verified-staff-id' })
    expect(mocks.adapter!.getAll()).toContainEqual({ name: 'sb-test-auth-token', value: 'cookie-value' })
    mocks.adapter!.setAll([{ name: 'sb-test-auth-token', value: 'refreshed-value', options: { httpOnly: true } }])
    expect(request.cookies.get('sb-test-auth-token')?.value).toBe('refreshed-value')
    expect(response.cookies.get('sb-test-auth-token')?.httpOnly).toBe(true)
  })
  it('never derives identity from an unverified cookie', async () => {
    mocks.claims.mockResolvedValue({ data: null })
    expect(await getProxyUser(new NextRequest('https://app.example/orders'), NextResponse.next())).toBeNull()
  })
})
