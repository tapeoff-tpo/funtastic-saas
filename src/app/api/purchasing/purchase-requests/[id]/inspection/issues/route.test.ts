import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'

const mocks = vi.hoisted(() => ({ user: vi.fn(), owner: vi.fn(), create: vi.fn() }))
vi.mock('@/lib/auth/current-user', () => ({ getCurrentUser: mocks.user }))
vi.mock('@/lib/admin-accounts/queries', () => ({ getWorkspaceUserId: mocks.owner }))
vi.mock('@/lib/purchasing/purchase-inspection-issues', () => ({
  createPurchaseInspectionIssue: mocks.create,
  INSPECTION_ISSUE_IMAGE_TYPES: new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  MAX_INSPECTION_ISSUE_ATTACHMENTS: 5,
  MAX_INSPECTION_ISSUE_ATTACHMENT_BYTES: 700 * 1024,
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const id = '00000000-0000-4000-8000-000000000001'
const context = { params: Promise.resolve({ id }) }

type UploadedPhoto = { name: string; type: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> }

function photo(name: string, type: string, content = 'photo'): UploadedPhoto {
  const bytes = new TextEncoder().encode(content)
  return { name, type, size: bytes.byteLength, arrayBuffer: async () => bytes.buffer }
}

function request(description = '', photos: UploadedPhoto[] = []) {
  return {
    formData: async () => ({
      get: (key: string) => key === 'description' ? description : null,
      getAll: (key: string) => key === 'photos' ? photos : [],
    }),
  } as unknown as NextRequest
}

describe('purchase inspection issue registration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.user.mockResolvedValue({ id: 'staff-id' })
    mocks.owner.mockResolvedValue('workspace-id')
    mocks.create.mockResolvedValue({ inspection: { revision: 2, hasReportedIssue: true }, issue: { id: 'issue-id', attachments: [] } })
  })

  it('allows description-only issue registration and records the real actor in the shared workspace', async () => {
    const response = await POST(request('박스 2번 모서리 파손'), context)
    expect(response.status).toBe(200)
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'workspace-id', actorId: 'staff-id', purchaseRequestItemId: id,
      description: '박스 2번 모서리 파손', attachments: [],
    }))
  })

  it('accepts bounded image files and passes their binary contents to persistence', async () => {
    const response = await POST(request('파손 사진 등록', [photo('damage.jpg', 'image/jpeg')]), context)
    expect(response.status).toBe(200)
    const input = mocks.create.mock.calls[0][0]
    expect(input.attachments).toHaveLength(1)
    expect(input.attachments[0]).toMatchObject({ fileName: 'damage.jpg', contentType: 'image/jpeg' })
    expect(new TextDecoder().decode(input.attachments[0].fileBuffer)).toBe('photo')
  })

  it('rejects missing descriptions and unsupported images before persistence', async () => {
    expect((await POST(request(), context)).status).toBe(400)
    const invalidResponse = await POST(request('문서', [photo('note.txt', 'text/plain')]), context)
    expect(invalidResponse.status).toBe(400)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('requires login before examining form data or workspace ownership', async () => {
    mocks.user.mockResolvedValue(null)
    expect((await POST(request('오류'), context)).status).toBe(401)
    expect(mocks.owner).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
  })
})
