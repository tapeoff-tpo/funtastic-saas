// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ workspace: vi.fn(), save: vi.fn(), list: vi.fn(), load: vi.fn() }))
vi.mock('@/lib/coupang-registration/auth', () => ({ registrationWorkspace: mocks.workspace }))
vi.mock('@/lib/coupang-registration/store', () => ({ saveDraft: mocks.save, listDrafts: mocks.list, loadDraft: mocks.load }))
import { GET, POST } from '@/app/api/operations/coupang-registration/drafts/route'
import { blankDraft } from '@/lib/coupang-registration/model'

describe('shared registration drafts', () => {
  beforeEach(() => vi.clearAllMocks())
  it('denies unauthenticated access without listing or saving data', async () => {
    mocks.workspace.mockResolvedValue(null)
    expect((await GET(new NextRequest('http://test/api/operations/coupang-registration/drafts'))).status).toBe(403)
    expect(mocks.list).not.toHaveBeenCalled()
  })
  it('reads and writes under the canonical workspace rather than a client supplied owner', async () => {
    mocks.workspace.mockResolvedValue('workspace-owner')
    mocks.save.mockResolvedValue({ id: 'saved-id', revision: 1 })
    const response = await POST(new NextRequest('http://test/api/operations/coupang-registration/drafts', { method: 'POST', body: JSON.stringify({ userId: 'other-owner', draft: blankDraft() }) }))
    expect(response.status).toBe(200)
    expect(mocks.save).toHaveBeenCalledWith('workspace-owner', blankDraft(), undefined, undefined)
  })
  it('returns a conflict rather than overwriting a newer draft revision', async () => {
    mocks.workspace.mockResolvedValue('workspace-owner'); mocks.save.mockResolvedValue(null)
    const response = await POST(new NextRequest('http://test/api/operations/coupang-registration/drafts', { method: 'POST', body: JSON.stringify({ id: 'dcaf2711-a627-44ab-93cd-0645b706b6c4', revision: 1, draft: blankDraft() }) }))
    expect(response.status).toBe(409)
  })
})
