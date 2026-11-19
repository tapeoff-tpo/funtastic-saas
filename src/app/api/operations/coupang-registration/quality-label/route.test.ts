// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  workspace: vi.fn(),
  currentUser: vi.fn(),
  attachment: vi.fn(),
  render: vi.fn(),
}))

vi.mock('@/lib/coupang-registration/auth', () => ({ registrationWorkspace: mocks.workspace }))
vi.mock('@/lib/auth/current-user', () => ({ getCurrentUser: mocks.currentUser }))
vi.mock('@/lib/new-products/workflow', () => ({ getNewProductAttachment: mocks.attachment }))
vi.mock('@/lib/coupang-registration/quality-label-renderer', () => ({ renderQualityPdfLabels: mocks.render }))

import { POST } from './route'

const attachmentId = '46549232-f6ec-47ba-99cc-ba14a3cdfb37'

describe('Coupang quality-label conversion route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.workspace.mockResolvedValue('workspace-owner')
    mocks.currentUser.mockResolvedValue({ id: 'actor-user' })
  })

  it('reads the private Product Management PDF from the canonical workspace and returns generated labels', async () => {
    mocks.attachment.mockResolvedValue({ fileName: '품질표시.pdf', contentType: 'application/pdf', fileDataBase64: Buffer.from('%PDF-1.4').toString('base64') })
    mocks.render.mockResolvedValue([{ name: '품질표시-p1.jpg', data: 'aGVsbG8=' }])
    const response = await POST(new Request('http://localhost/api/operations/coupang-registration/quality-label', {
      method: 'POST', body: JSON.stringify({ attachmentId }), headers: { 'Content-Type': 'application/json' },
    }) as never)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ labels: [{ name: '품질표시-p1.jpg', data: 'aGVsbG8=' }] })
    expect(mocks.attachment).toHaveBeenCalledWith({ userId: 'workspace-owner', requestedByUserId: 'actor-user', attachmentId })
  })

  it('rejects non-PDF Product Management attachments before rendering', async () => {
    mocks.attachment.mockResolvedValue({ fileName: 'label.jpg', contentType: 'image/jpeg', fileDataBase64: 'aGVsbG8=' })
    const response = await POST(new Request('http://localhost/api/operations/coupang-registration/quality-label', {
      method: 'POST', body: JSON.stringify({ attachmentId }), headers: { 'Content-Type': 'application/json' },
    }) as never)
    expect(response.status).toBe(400)
    expect(mocks.render).not.toHaveBeenCalled()
  })

  it('requires existing Coupang-registration access', async () => {
    mocks.workspace.mockResolvedValue(null)
    const response = await POST(new Request('http://localhost/api/operations/coupang-registration/quality-label', {
      method: 'POST', body: JSON.stringify({ attachmentId }), headers: { 'Content-Type': 'application/json' },
    }) as never)
    expect(response.status).toBe(403)
    expect(mocks.attachment).not.toHaveBeenCalled()
  })
})
