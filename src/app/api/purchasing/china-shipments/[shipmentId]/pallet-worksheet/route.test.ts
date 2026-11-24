import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ user: vi.fn(), access: vi.fn(), owner: vi.fn(), detail: vi.fn(), render: vi.fn() }))
vi.mock('@/lib/auth/current-user', () => ({ getCurrentUser: mocks.user }))
vi.mock('@/lib/auth/menu-access', () => ({ getUserMenuAccess: mocks.access }))
vi.mock('@/lib/admin-accounts/queries', () => ({ getWorkspaceUserId: mocks.owner }))
vi.mock('@/lib/purchasing/saas-china-outbound', () => ({ getChinaOutboundShipmentDetail: mocks.detail }))
vi.mock('@/lib/purchasing/china-pallet-worksheet-print', () => ({ renderChinaPalletWorksheet: mocks.render }))
import { GET } from './route'
const shipmentId = '11111111-1111-4111-8111-111111111111'
const context = { params: Promise.resolve({ shipmentId }) }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.user.mockResolvedValue({ id: 'staff' })
  mocks.access.mockResolvedValue({ allowedMenus: ['/purchasing/china-shipments'], superAdmin: false })
  mocks.owner.mockResolvedValue('workspace-owner')
  mocks.detail.mockResolvedValue({ shipment: { id: shipmentId } })
  mocks.render.mockReturnValue('<html>worksheet</html>')
})
it('serves the shared shipment worksheet with a nonce and no cache', async () => {
  const response = await GET(new Request('http://localhost'), context)
  expect(response.status).toBe(200)
  expect(mocks.detail).toHaveBeenCalledWith({ userId: 'workspace-owner', shipmentId })
  expect(response.headers.get('content-type')).toContain('text/html')
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(response.headers.get('content-security-policy')).toContain(`nonce-${mocks.render.mock.calls[0][1]}`)
})
it('denies unauthorized or absent shipments before rendering', async () => {
  mocks.user.mockResolvedValueOnce(null)
  expect((await GET(new Request('http://localhost'), context)).status).toBe(401)
  expect(mocks.detail).not.toHaveBeenCalled()
  mocks.access.mockResolvedValueOnce({ allowedMenus: [], superAdmin: false })
  expect((await GET(new Request('http://localhost'), context)).status).toBe(403)
  mocks.detail.mockResolvedValueOnce(null)
  expect((await GET(new Request('http://localhost'), context)).status).toBe(404)
  expect(mocks.render).not.toHaveBeenCalled()
})
