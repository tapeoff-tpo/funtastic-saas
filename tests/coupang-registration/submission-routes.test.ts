// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ workspace: vi.fn(), submit: vi.fn(), list: vi.fn(), record: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/coupang-registration/auth', () => ({ registrationWorkspace: mocks.workspace }))
vi.mock('@/lib/coupang-registration/submissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/coupang-registration/submissions')>()
  return { ...actual, submitRegistration: mocks.submit, getSubmissions: mocks.list, recordSubmissionEvent: mocks.record }
})
import { POST as submit } from '@/app/api/operations/coupang-registration/submit/route'
import { GET as status, POST as record } from '@/app/api/operations/coupang-registration/submissions/route'
import { RegistrationConflict } from '@/lib/coupang-registration/submissions'

const workspace = '7c3ff1ad-3b8c-4fa1-9efe-961b048694c0'
const draftId = 'f7b209a8-a3d7-41c5-b445-8d87e7a39f5d'
const jobId = '9bcd6c67-d737-44f7-9a65-c702d4b1d58c'
const baseUrl = 'http://test/api/operations/coupang-registration'
const submitRequest = (body: unknown) => new NextRequest(`${baseUrl}/submit`, { method: 'POST', body: JSON.stringify(body) })
const event = { draftId, jobId, token: 'a'.repeat(48), status: 'running', message: '검증 중' }
const eventRequest = (body: unknown) => new NextRequest(`${baseUrl}/submissions`, { method: 'POST', body: JSON.stringify(body) })

describe('workspace-authenticated Coupang submission routes', () => {
  beforeEach(() => vi.clearAllMocks())

  it('denies anonymous submit/status/events before reading or mutating jobs', async () => {
    mocks.workspace.mockResolvedValue(null)
    expect((await submit(submitRequest({ draftId, revision: 1, rowIds: ['row-1'] }))).status).toBe(403)
    expect((await status(new NextRequest(`${baseUrl}/submissions?draftId=${draftId}`))).status).toBe(403)
    expect((await record(eventRequest(event))).status).toBe(403)
    expect(mocks.submit).not.toHaveBeenCalled()
    expect(mocks.list).not.toHaveBeenCalled()
    expect(mocks.record).not.toHaveBeenCalled()
  })

  it('submits only with the canonical workspace resolved by the server', async () => {
    mocks.workspace.mockResolvedValue(workspace)
    mocks.submit.mockResolvedValue({ revision: 2, submission: { jobId, status: 'queued' } })
    const response = await submit(submitRequest({ draftId, revision: 1, rowIds: ['row-1'], userId: 'forged-owner' }))
    expect(response.status).toBe(200)
    expect(mocks.submit).toHaveBeenCalledWith(workspace, draftId, 1, ['row-1'])
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  it('reports stale revisions as conflict and rejects empty selection before enqueueing', async () => {
    mocks.workspace.mockResolvedValue(workspace)
    mocks.submit.mockRejectedValue(new RegistrationConflict('최신 작업을 불러와주세요.'))
    expect((await submit(submitRequest({ draftId, revision: 1, rowIds: ['row-1'] }))).status).toBe(409)
    mocks.submit.mockClear()
    expect((await submit(submitRequest({ draftId, revision: 1, rowIds: [] }))).status).toBe(400)
    expect(mocks.submit).not.toHaveBeenCalled()
  })

  it('reads job status and accepts events only under the authenticated workspace', async () => {
    mocks.workspace.mockResolvedValue(workspace)
    mocks.list.mockResolvedValue({ submissions: [] })
    mocks.record.mockResolvedValue({ submissions: [{ status: 'running' }] })
    expect((await status(new NextRequest(`${baseUrl}/submissions?draftId=${draftId}&userId=forged`))).status).toBe(200)
    expect(mocks.list).toHaveBeenCalledWith(workspace, draftId)
    expect((await record(eventRequest({ ...event, userId: 'forged-owner' }))).status).toBe(200)
    expect(mocks.record).toHaveBeenCalledWith(workspace, event)
    mocks.list.mockClear()
    expect((await status(new NextRequest(`${baseUrl}/submissions?draftId=bad-id`))).status).toBe(400)
    expect(mocks.list).not.toHaveBeenCalled()
    mocks.record.mockClear()
    expect((await record(eventRequest({ ...event, token: 'wrong' }))).status).toBe(400)
    expect(mocks.record).not.toHaveBeenCalled()
  })
})
