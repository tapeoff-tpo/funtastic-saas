// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ workspace: vi.fn(), archive: vi.fn(), download: vi.fn() }))
vi.mock('@/lib/coupang-registration/auth', () => ({ registrationWorkspace: mocks.workspace }))
vi.mock('@/lib/coupang-registration/excel', () => ({ buildRegistrationArchive: mocks.archive, buildRegistrationDownload: mocks.download }))
import { POST } from '@/app/api/operations/coupang-registration/export/route'
import { blankDraft, confirmPricing, createRegistrationRow } from '@/lib/coupang-registration/model'
import { draftSchema } from '@/lib/coupang-registration/schema'

const endpoint = 'http://test/api/operations/coupang-registration/export'
const request = (body: unknown) => new NextRequest(endpoint, { method: 'POST', body: JSON.stringify(body) })
const draft = () => draftSchema.parse(JSON.parse(JSON.stringify({ ...blankDraft(), rows: [confirmPricing({ ...createRegistrationRow(), name: '저장한 상품', costPrice: 1000, wholesalePrice: 2000 })] })))

describe('Coupang original-template downloads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.workspace.mockResolvedValue('canonical-workspace')
    mocks.archive.mockResolvedValue(Buffer.from('legacy-zip'))
    mocks.download.mockResolvedValue({ buffer: Buffer.from('official-xlsx'), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fileName: '가구_등록용.xlsx' })
  })

  it('denies anonymous downloads before processing templates', async () => {
    mocks.workspace.mockResolvedValue(null)
    expect((await POST(request({ draft: draft() }))).status).toBe(403)
    expect(mocks.download).not.toHaveBeenCalled()
    expect(mocks.archive).not.toHaveBeenCalled()
  })

  it('downloads selected stage-two products with encoded filename and private response headers', async () => {
    const saved = draft()
    const response = await POST(request({ draft: saved, rowIds: [saved.rows[0].id], userId: 'forged-owner' }))
    expect(response.status).toBe(200)
    expect(mocks.download).toHaveBeenCalledWith(saved, [saved.rows[0].id])
    expect(response.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    expect(response.headers.get('content-disposition')).toBe(`attachment; filename*=UTF-8''${encodeURIComponent('가구_등록용.xlsx')}`)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.text()).toBe('official-xlsx')
    expect(mocks.archive).not.toHaveBeenCalled()
  })

  it('uses the information-stage helper when no individual selection is specified', async () => {
    const saved = draft()
    expect((await POST(request({ draft: saved }))).status).toBe(200)
    expect(mocks.download).toHaveBeenCalledWith(saved, undefined)
  })

  it('retains the legacy complete-draft ZIP request contract', async () => {
    const saved = draft()
    const response = await POST(request(saved))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/zip')
    expect(await response.text()).toBe('legacy-zip')
    expect(mocks.archive).toHaveBeenCalledWith(saved)
    expect(mocks.download).not.toHaveBeenCalled()
  })

  it.each([{ rowIds: [] }, { rowIds: ['same', 'same'] }, { rowIds: [1] }, { rowIds: [''] }])('rejects malformed or duplicate selection %j', async ({ rowIds }) => {
    expect((await POST(request({ draft: draft(), rowIds }))).status).toBe(400)
    expect(mocks.download).not.toHaveBeenCalled()
  })

  it('returns template-validation failures without a download response', async () => {
    mocks.download.mockRejectedValue(new Error('검색태그 누락'))
    const response = await POST(request({ draft: draft() }))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: '검색태그 누락' })
    expect(response.headers.get('content-disposition')).toBeNull()
  })
})
