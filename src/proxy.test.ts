import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { proxy } from './proxy'

const mocks = vi.hoisted(() => ({ user: vi.fn(), access: vi.fn() }))
vi.mock('@/lib/auth/proxy-user', () => ({ getProxyUser: mocks.user }))
vi.mock('@/lib/auth/menu-access', () => ({ getUserMenuAccess: mocks.access }))
function request(path: string, method = 'GET') {
  return new NextRequest(`https://app.example${path}`, { method, headers: { cookie: 'sb-test-auth-token=untrusted-cookie', referer: 'https://app.example/purchasing/china-shipments' } })
}
describe('request menu authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.user.mockResolvedValue({ id: 'staff-id', mustChangePassword: false })
    mocks.access.mockResolvedValue({ superAdmin: false, allowedMenus: ['/purchasing/china-shipments'] })
  })
  it('rejects a direct forbidden API despite an allowed Referer', async () => {
    const response = await proxy(request('/api/purchasing/items/export'))
    expect(response.status).toBe(403)
    expect(response.headers.get('Cache-Control')).toContain('no-store')
  })
  it('redirects forbidden page visits without rendering the page and blocks POST actions', async () => {
    expect((await proxy(request('/costs'))).headers.get('location')).toBe('https://app.example/access-denied')
    expect((await proxy(request('/costs', 'POST'))).status).toBe(403)
  })
  it('lets an allowed shipment request proceed', async () => {
    expect((await proxy(request('/api/purchasing/china-shipments/1/workbook'))).headers.get('x-middleware-next')).toBe('1')
  })
  it('forwards refreshed auth cookies to both the route request and browser', async () => {
    mocks.user.mockImplementationOnce(async (req, res) => {
      req.cookies.set('sb-test-auth-token', 'refreshed-cookie')
      res.cookies.set('sb-test-auth-token', 'refreshed-cookie')
      return { id: 'staff-id' }
    })
    const response = await proxy(request('/purchasing/china-shipments'))
    expect(response.headers.get('x-middleware-request-cookie')).toContain('refreshed-cookie')
    expect(response.cookies.get('sb-test-auth-token')?.value).toBe('refreshed-cookie')
  })
  it('validates identity instead of trusting the mere presence of an auth cookie', async () => {
    mocks.user.mockResolvedValue(null)
    expect((await proxy(request('/api/purchasing/china-shipments/1/workbook'))).status).toBe(401)
    expect(mocks.access).not.toHaveBeenCalled()
  })
  it('leaves separately authenticated device endpoints independent', async () => {
    expect((await proxy(request('/api/sms-bridge/messages', 'POST'))).headers.get('x-middleware-next')).toBe('1')
    expect(mocks.user).not.toHaveBeenCalled()
  })
})
