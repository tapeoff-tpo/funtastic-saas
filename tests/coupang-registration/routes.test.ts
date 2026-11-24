// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ workspace: vi.fn(), save: vi.fn(), list: vi.fn(), load: vi.fn(), readTemplate: vi.fn() }))
vi.mock('@/lib/coupang-registration/auth', () => ({ registrationWorkspace: mocks.workspace }))
vi.mock('@/lib/coupang-registration/store', () => ({ saveDraft: mocks.save, listDrafts: mocks.list, loadDraft: mocks.load }))
vi.mock('@/lib/coupang-registration/excel', async (importOriginal) => ({ ...await importOriginal<object>(), readTemplate: mocks.readTemplate }))
import { GET, POST } from '@/app/api/operations/coupang-registration/drafts/route'
import { blankDraft, createRegistrationRow } from '@/lib/coupang-registration/model'

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
    mocks.load.mockResolvedValue({ id: 'dcaf2711-a627-44ab-93cd-0645b706b6c4', revision: 1, payload: blankDraft() })
    const response = await POST(new NextRequest('http://test/api/operations/coupang-registration/drafts', { method: 'POST', body: JSON.stringify({ id: 'dcaf2711-a627-44ab-93cd-0645b706b6c4', revision: 1, draft: blankDraft() }) }))
    expect(response.status).toBe(409)
    expect(mocks.save).toHaveBeenCalledTimes(1)
  })
  it('refreshes official choices for old saved templates without changing products or writing the draft', async () => {
    const id = 'dcaf2711-a627-44ab-93cd-0645b706b6c4'
    const file = { name: 'official.xlsx', data: Buffer.from('official bytes').toString('base64') }
    const template = { id: 'template-hash', name: file.name, file, sheets: [{ name: 'QF_2379_shelf', columns: [] }] }
    const row = { ...createRegistrationRow(), name: '내 상품', templateId: template.id, sheetName: template.sheets[0].name, fields: { 브랜드: '내 브랜드' }, label: 'my-label.jpg', manualSupplyPrice: 13000, manualSalePrice: 21667 }
    const unused = { ...template, id: 'unused', name: 'unused.xlsx', file: { name: 'unused.xlsx', data: 'not-a-workbook' } }
    const payload = { ...blankDraft(), rows: [row], templates: [template, unused] }
    const sheets = [{ ...template.sheets[0], columns: [{ column: 2, label: '카테고리', requirement: '필수', guide: '', choices: ['공식 스탠드선반 (77940)'], allowCustom: true }] }]
    mocks.workspace.mockResolvedValue('workspace-owner')
    mocks.load.mockResolvedValue({ id, revision: 7, payload })
    mocks.readTemplate.mockResolvedValue({ template: { ...template, sheets }, rows: [createRegistrationRow()] })
    const response = await GET(new NextRequest(`http://test/api/operations/coupang-registration/drafts?id=${id}`))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ id, revision: 7, payload: { ...payload, templates: [{ ...template, sheets }, unused] } })
    expect(mocks.load).toHaveBeenCalledWith('workspace-owner', id)
    expect(mocks.readTemplate).toHaveBeenCalledWith(Buffer.from('official bytes'), file.name)
    expect(mocks.readTemplate).toHaveBeenCalledTimes(1)
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('refuses changed template bytes during metadata refresh without modifying saved data', async () => {
    mocks.workspace.mockResolvedValue('workspace-owner')
    mocks.load.mockResolvedValue({ id: 'dcaf2711-a627-44ab-93cd-0645b706b6c4', revision: 7, payload: { ...blankDraft(), rows: [{ ...createRegistrationRow(), templateId: 'expected' }], templates: [{ id: 'expected', name: 'official.xlsx', file: { name: 'official.xlsx', data: 'QQ==' }, sheets: [] }] } })
    mocks.readTemplate.mockResolvedValue({ template: { id: 'different' } })
    const response = await GET(new NextRequest('http://test/api/operations/coupang-registration/drafts?id=dcaf2711-a627-44ab-93cd-0645b706b6c4'))
    expect(response.status).toBe(400)
    expect(mocks.save).not.toHaveBeenCalled()
  })
})
