import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  assertMenuAccess: vi.fn(),
  getWorkspaceUserId: vi.fn(),
  parse: vi.fn(),
  save: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/auth/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser } }) }))
vi.mock('@/lib/auth/menu-access', () => ({ assertMenuAccess: mocks.assertMenuAccess }))
vi.mock('@/lib/admin-accounts/queries', () => ({ getWorkspaceUserId: mocks.getWorkspaceUserId }))
vi.mock('@/lib/analytics/short-meeting-upload-parser', () => ({ parseShortMeetingWorkbook: mocks.parse }))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/analytics/short-meeting-uploads', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/analytics/short-meeting-uploads')>(),
  saveShortMeetingUpload: mocks.save,
}))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))

import { POST } from './route'

const parsed = {
  rowCount: 2, productCount: 1, totalQuantity: 5, warnings: ['3행: 제외'],
  items: [{ sku: '123-0001', productName: '상품', optionName: '옵션', quantity: 5 }],
}

function request(action = 'preview', meetingDate = '2026-11-12') {
  const file = new File(['test'], '주문서.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  // jsdom's File does not implement arrayBuffer.
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array([1, 2, 3]).buffer })
  const values: Record<string, unknown> = { file, action, meetingDate }
  return { formData: async () => ({ get: (key: string) => values[key] ?? null }) } as never
}

describe('POST /api/analytics/short-meeting/upload', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'actor' } }, error: null })
    mocks.assertMenuAccess.mockResolvedValue(undefined)
    mocks.getWorkspaceUserId.mockResolvedValue('workspace')
    mocks.parse.mockResolvedValue(parsed)
    mocks.save.mockResolvedValue(undefined)
  })

  it('rejects unauthenticated users before processing', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null })
    const response = await POST(request())
    expect(response.status).toBe(401)
    expect(mocks.assertMenuAccess).not.toHaveBeenCalled()
    expect(mocks.parse).not.toHaveBeenCalled()
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('rejects users without access to the short meeting menu', async () => {
    mocks.assertMenuAccess.mockRejectedValue(new Error('denied'))
    const response = await POST(request())
    expect(response.status).toBe(403)
    expect(mocks.assertMenuAccess).toHaveBeenCalledWith('/analytics/short-meeting')
    expect(mocks.parse).not.toHaveBeenCalled()
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('previews parsed totals and warnings without saving or changing the workspace', async () => {
    const response = await POST(request('preview'))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ success: true, meetingDate: '2026-11-12', rowCount: 2, totalQuantity: 5, warnings: parsed.warnings, preview: parsed.items })
    expect(mocks.parse).toHaveBeenCalledWith(Buffer.from([1, 2, 3]))
    expect(mocks.save).not.toHaveBeenCalled()
    expect(mocks.getWorkspaceUserId).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it('saves the applied snapshot under the shared workspace and refreshes the page', async () => {
    const response = await POST(request('apply'))
    expect(response.status).toBe(200)
    expect(mocks.getWorkspaceUserId).toHaveBeenCalledWith('actor')
    expect(mocks.save).toHaveBeenCalledWith({
      userId: 'workspace', actorId: 'actor', meetingDate: '2026-11-12', fileName: '주문서.xlsx',
      buffer: Buffer.from([1, 2, 3]), rowCount: 2, items: parsed.items,
    })
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/analytics/short-meeting')
  })

  it.each(['2026-02-30', '2026-13-01', '2026-11-1', ''])('rejects invalid date %s before parsing', async (date) => {
    const response = await POST(request('apply', date))
    expect(response.status).toBe(400)
    expect(mocks.parse).not.toHaveBeenCalled()
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('does not save a workbook the parser rejects', async () => {
    mocks.parse.mockRejectedValue(new Error('필수 열 누락'))
    const response = await POST(request('apply'))
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: '필수 열 누락' })
    expect(mocks.save).not.toHaveBeenCalled()
  })
})
