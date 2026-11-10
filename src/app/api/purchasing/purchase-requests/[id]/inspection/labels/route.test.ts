// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
import { GET, POST } from './route'

const mocks = vi.hoisted(() => ({ access: vi.fn(), target: vi.fn(), files: vi.fn(), read: vi.fn(), upload: vi.fn() }))
vi.mock('@/lib/auth/current-user', () => ({ getCurrentUser: async () => ({ id: 'staff', mustChangePassword: false }) }))
vi.mock('@/lib/auth/menu-access', () => ({ getUserMenuAccess: mocks.access }))
vi.mock('@/lib/admin-accounts/queries', () => ({ getWorkspaceUserId: async () => 'workspace' }))
vi.mock('@/lib/purchasing/purchase-inspection-label-files', () => ({
  getInspectionLabelTarget: mocks.target,
  listInspectionLabelFiles: mocks.files,
  readInspectionLabelBody: mocks.read,
  uploadInspectionLabel: mocks.upload,
}))

const purchaseId = '00000000-0000-4000-8000-000000000001'
const fileId = '00000000-0000-4000-8000-000000000002'
const context = { params: Promise.resolve({ id: purchaseId }) }
const endpoint = 'https://example.test/inspection/labels'
const file = { id: fileId, source: 'works', kind: 'quality', contentType: 'application/pdf', fileName: '라벨.pdf', fileSize: 6, objectKey: 'private-key' }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.access.mockResolvedValue({ superAdmin: false, allowedMenus: ['/purchasing/orders'] })
  mocks.target.mockResolvedValue({ sku: 'SKU-A', status: 'inspecting' })
  mocks.files.mockResolvedValue([file])
  mocks.read.mockImplementation(async () => new Response('%PDF-1').body)
})

it('lists safe metadata and serves the matched SKU’s PDF inline', async () => {
  const metadata = await GET(new Request(endpoint), context)
  expect(await metadata.json()).toEqual({ files: [{ id: fileId, source: 'works', kind: 'quality', contentType: 'application/pdf', fileName: '라벨.pdf' }] })
  const download = await GET(new Request(`${endpoint}?file=${fileId}&source=works&print=1`), context)
  expect(download.headers.get('content-disposition')).toMatch(/^inline/)
  expect(await download.text()).toBe('%PDF-1')
  expect(mocks.files).toHaveBeenCalledWith('workspace', 'SKU-A')
})

it('rejects unrelated file IDs and callers without inspection access before reading bytes', async () => {
  const response = await GET(new Request(`${endpoint}?file=${purchaseId}&source=works`), context)
  expect(response.status).toBe(404)
  mocks.access.mockResolvedValue({ superAdmin: false, allowedMenus: ['/new-products'] })
  expect((await GET(new Request(endpoint), context)).status).toBe(403)
  expect(mocks.read).not.toHaveBeenCalled()
})

it('prints an image using its protected file URL', async () => {
  mocks.files.mockResolvedValue([{ ...file, contentType: 'image/png', kind: 'barcode' }])
  const response = await GET(new Request(`${endpoint}?file=${fileId}&source=works&print=1`), context)
  expect(response.headers.get('content-type')).toContain('text/html')
  const html = await response.text()
  expect(html).toContain(`?file=${fileId}&amp;source=works`)
  expect(html).toContain('window.print()')
  expect(mocks.read).not.toHaveBeenCalled()
})

it('registers files against the inspected SKU rather than any caller-supplied product code', async () => {
  mocks.upload.mockResolvedValue({ id: fileId, kind: 'barcode', source: 'upload', fileName: '라벨.pdf', contentType: 'application/pdf' })
  const body = new FormData()
  body.set('kind', 'barcode')
  body.set('sku', 'OTHER-SKU')
  body.set('file', new File(['%PDF-1'], '라벨.pdf', { type: 'application/pdf' }))
  const response = await POST(new Request(endpoint, { method: 'POST', body }), context)
  expect(response.status).toBe(201)
  expect(mocks.upload).toHaveBeenCalledWith(expect.objectContaining({ userId: 'workspace', actorId: 'staff', sku: 'SKU-A', kind: 'barcode' }))
})
