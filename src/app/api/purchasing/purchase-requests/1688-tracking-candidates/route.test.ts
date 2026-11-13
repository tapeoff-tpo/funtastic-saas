import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ user: vi.fn(), owner: vi.fn(), access: vi.fn(), candidates: vi.fn() }))
vi.mock('@/lib/auth/current-user', () => ({ getCurrentUser: mocks.user }))
vi.mock('@/lib/admin-accounts/queries', () => ({ getWorkspaceUserId: mocks.owner }))
vi.mock('@/lib/auth/menu-access', () => ({ getUserMenuAccess: mocks.access }))
vi.mock('@/lib/purchasing/purchase-tracking-candidates', () => ({ getPurchase1688TrackingCandidates: mocks.candidates }))
import { GET } from './route'

describe('all-stage 1688 tracking candidates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.user.mockResolvedValue({ id: 'staff' })
    mocks.owner.mockResolvedValue('canonical-workspace')
    mocks.access.mockResolvedValue({ superAdmin: false, allowedMenus: ['/purchasing/orders'] })
    mocks.candidates.mockResolvedValue(Array.from({ length: 110 }, (_, i) => ({ id: String(i) })))
  })

  it('returns the complete purchase-completed stage under the shared workspace without pagination', async () => {
    const response = await GET(new Request('https://example.com/api/purchasing/purchase-requests/1688-tracking-candidates?mode=initial&pageSize=50'))
    expect(response.status).toBe(200)
    expect((await response.json()).candidates).toHaveLength(110)
    expect(mocks.candidates).toHaveBeenCalledWith('canonical-workspace', 'initial')
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('selects inspection for recollection and rejects unsupported modes', async () => {
    await GET(new Request('https://example.com/?mode=recollect'))
    expect(mocks.candidates).toHaveBeenCalledWith('canonical-workspace', 'recollect')
    expect((await GET(new Request('https://example.com/?mode=completed'))).status).toBe(400)
  })

  it('requires login and purchasing operations permission before reading operational data', async () => {
    mocks.user.mockResolvedValue(null)
    expect((await GET(new Request('https://example.com/'))).status).toBe(401)
    mocks.user.mockResolvedValue({ id: 'reviewer' })
    mocks.access.mockResolvedValue({ superAdmin: false, allowedMenus: ['/purchasing/purchases'] })
    expect((await GET(new Request('https://example.com/'))).status).toBe(403)
    expect(mocks.candidates).not.toHaveBeenCalled()
  })
})
