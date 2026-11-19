import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), access: vi.fn(), owner: vi.fn(), upload: vi.fn() }))
vi.mock('@/lib/auth/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser } }) }))
vi.mock('@/lib/auth/menu-access', () => ({ assertMenuAccess: mocks.access }))
vi.mock('@/lib/admin-accounts/queries', () => ({ getWorkspaceUserId: mocks.owner }))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/analytics/short-meeting-uploads', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/analytics/short-meeting-uploads')>(),
  getLatestShortMeetingUpload: mocks.upload,
}))
import { POST } from './route'

function request(body: unknown = { date: '2026-11-12' }) {
  return { json: async () => body } as never
}

describe('POST /api/analytics/short-meeting/original', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'actor' } }, error: null })
    mocks.access.mockResolvedValue(undefined)
    mocks.owner.mockResolvedValue('shared-owner')
    mocks.upload.mockResolvedValue({ appliedAt: '2026-11-12T01:00:00Z', rawData: {
      headers: ['상품명', '수량'],
      rows: [{ rowNumber: 2, cells: ['상품 A', '10'], excludedReason: null }, { rowNumber: 3, cells: ['상품 B', '2'], excludedReason: null }],
    } })
  })

  it('rejects unauthenticated and unauthorized users before reading data', async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: null })
    expect((await POST(request())).status).toBe(401)
    mocks.access.mockRejectedValueOnce(new Error('denied'))
    expect((await POST(request())).status).toBe(403)
    expect(mocks.upload).not.toHaveBeenCalled()
  })

  it('uses the shared workspace and applies filtering and sorting without caching private rows', async () => {
    const response = await POST(request({ date: '2026-11-12', sort: 1, direction: 'ascending', search: '상품', page: 1 }))
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(mocks.owner).toHaveBeenCalledWith('actor')
    expect(mocks.upload).toHaveBeenCalledWith('shared-owner', '2026-11-12', { includeRaw: true })
    const body = await response.json()
    expect(body).toMatchObject({ rawAvailable: true, totalRows: 2, filteredRows: 2, totalPages: 1, appliedAt: '2026-11-12T01:00:00Z' })
    expect(body.rows.map((row: { rowNumber: number }) => row.rowNumber)).toEqual([3, 2])
  })

  it('handles a legacy upload without original rows', async () => {
    mocks.upload.mockResolvedValueOnce({ rawData: null, appliedAt: '2026-11-12T01:00:00Z' })
    const response = await POST(request())
    await expect(response.json()).resolves.toMatchObject({ rawAvailable: false, rows: [], appliedAt: '2026-11-12T01:00:00Z' })
  })

  it.each([
    { date: '2026-02-30' }, { date: '2026-11-12', page: 0 }, { date: '2026-11-12', sort: -1 },
    { date: '2026-11-12', direction: 'sideways' }, { date: '2026-11-12', sort: 2 },
    { date: '2026-11-12', search: ['sensitive'] }, null,
  ])('rejects invalid parameters: %s', async (body) => {
    expect((await POST(request(body))).status).toBe(400)
  })
})
