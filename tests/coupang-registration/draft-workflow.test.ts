// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { prepareDraftSave } from '@/lib/coupang-registration/draft-workflow'
import { applyRegistrationSubmission, blankDraft, calculatePrice, confirmPricing, confirmRegistration, createRegistrationRow, getRegistrationStage, type RegistrationDraft } from '@/lib/coupang-registration/model'

const now = '2026-11-23T07:00:00.000Z'
function fixture() {
  const row = { ...createRegistrationRow(), name: '샘플', templateId: 'template-1', priceMode: 'manual' as const, manualSupplyPrice: 1000, saleMode: 'manual' as const, manualSalePrice: 2000, label: '라벨.jpg' }
  const draft: RegistrationDraft = {
    ...blankDraft(), rows: [row],
    templates: [{ id: 'template-1', name: '양식.xlsx', file: { name: '양식.xlsx', data: 'original-template' }, sheets: [] }],
    labels: [{ name: '라벨.jpg', data: 'original-label' }],
  }
  return { row, draft }
}
function lockedFixture(status: 'queued' | 'running' | 'login_required' | 'succeeded') {
  const { row, draft } = fixture()
  let locked = applyRegistrationSubmission(confirmPricing(row, 1, now), { status: 'queued', jobId: 'job-1', requestedAt: now })
  if (status !== 'queued') locked = applyRegistrationSubmission(locked, { status, jobId: 'job-1', completedAt: status === 'succeeded' ? now : undefined, receiptId: status === 'succeeded' ? 'receipt-1' : undefined })
  return { row: locked, draft: { ...draft, rows: [locked] } }
}

describe('server-protected Coupang draft saving', () => {
  it('strips forged submission metadata and cannot create registered products through draft saves', () => {
    const { row, draft } = fixture()
    draft.rows = [{ ...row, stage: 'registered', registeredAt: now, submission: { status: 'succeeded', jobId: 'forged', completedAt: now, receiptId: 'forged' } }]
    const saved = prepareDraftSave(draft)
    expect(getRegistrationStage(saved.rows[0])).toBe('pricing')
    expect(saved.rows[0].submission).toBeUndefined()
    expect(saved.rows[0].registeredAt).toBeUndefined()
    expect(saved.rows[0].priceConfirmedAt).toBeUndefined()
  })

  it('validates and freezes price confirmation at the server boundary', () => {
    const { row, draft } = fixture()
    draft.rows = [{ ...row, stage: 'information', priceConfirmedAt: '2000-01-01T00:00:00Z', priceMode: 'wholesale', wholesalePrice: 1000, saleMode: 'auto' }]
    draft.rounding = 100
    const saved = prepareDraftSave(draft)
    expect(saved.rows[0].priceConfirmedAt).not.toBe('2000-01-01T00:00:00Z')
    expect(saved.rows[0]).toMatchObject({ stage: 'information', priceMode: 'manual', manualSupplyPrice: 1000, saleMode: 'manual', manualSalePrice: 1700 })
    expect(calculatePrice(saved.rows[0], 1000).sale).toBe(1700)
    expect(() => prepareDraftSave({ ...draft, rows: [{ ...draft.rows[0], wholesalePrice: null }] })).toThrow('공급가')
  })

  it('allows editing registration fields but requires returning to pricing before price changes', () => {
    const { row, draft } = fixture()
    const existing = { ...draft, rows: [confirmPricing(row, 1, now)] }
    const edited = { ...existing, rows: [{ ...existing.rows[0], fields: { 제조국: '중국' } }] }
    expect(prepareDraftSave(edited, existing).rows[0].fields).toEqual({ 제조국: '중국' })
    expect(() => prepareDraftSave({ ...edited, rows: [{ ...edited.rows[0], manualSalePrice: 3000 }] }, existing)).toThrow('판매가설정으로')
    expect(prepareDraftSave({ ...edited, rows: [{ ...edited.rows[0], stage: 'pricing', manualSalePrice: 3000 }] }, existing).rows[0]).toMatchObject({ stage: 'pricing', manualSalePrice: 3000, priceConfirmedAt: undefined })
  })

  it.each(['queued', 'running', 'login_required', 'succeeded'] as const)('retains %s rows and their assets even if omitted or replaced by the browser', (status) => {
    const { row, draft: existing } = lockedFixture(status)
    const incoming: RegistrationDraft = {
      ...blankDraft(), rounding: 1000,
      rows: [{ ...row, name: '변조된 상품', stage: 'pricing', label: '', submission: undefined }],
      templates: [{ ...existing.templates[0], file: { name: '양식.xlsx', data: 'forged-template' } }],
      labels: [{ name: '라벨.png', data: 'forged-label' }],
    }
    const saved = prepareDraftSave(incoming, existing)
    expect(saved.rows[0]).toBe(row)
    expect(saved.templates[0]).toEqual(existing.templates[0])
    expect(saved.labels).toEqual(existing.labels)
    expect(saved.rounding).toBe(existing.rounding)
    const omitted = prepareDraftSave(blankDraft(), existing)
    expect(omitted.rows).toEqual([row])
    expect(omitted.templates).toEqual(existing.templates)
    expect(omitted.labels).toEqual(existing.labels)
  })

  it('rejects duplicate rows, templates and ambiguous label stems', () => {
    const { row, draft } = fixture()
    expect(() => prepareDraftSave({ ...draft, rows: [row, row] })).toThrow('중복')
    expect(() => prepareDraftSave({ ...draft, templates: [draft.templates[0], draft.templates[0]] })).toThrow('중복')
    expect(() => prepareDraftSave({ ...draft, labels: [draft.labels[0], { name: '라벨.png', data: 'same-stem' }] })).toThrow('중복')
  })

  it('retains omitted manually completed rows until their exact ids are explicitly deleted', () => {
    const { row, draft } = fixture()
    const completed = confirmRegistration(confirmPricing(row, 1, now), '2026-11-23')
    const kept = { ...completed, id: 'keep-row', name: '보존할 등록완료 상품' }
    const existing = { ...draft, rows: [completed, kept] }
    expect(prepareDraftSave(blankDraft(), existing).rows).toEqual([completed, kept])

    // The deletion intent wins even if the submitted snapshot still contains that row.
    const saved = prepareDraftSave({ ...blankDraft(), rows: [completed, kept] }, existing, { deleteCompletedRowIds: [completed.id] })
    expect(saved.rows).toHaveLength(1)
    expect(saved.rows[0]).toMatchObject(kept)
    expect(saved.templates).toEqual(existing.templates)
    expect(saved.labels).toEqual(existing.labels)
    expect(existing.rows).toEqual([completed, kept])
  })

  it('requires an existing completed row and rejects unknown or duplicate deletion ids atomically', () => {
    const { row, draft } = fixture()
    const completed = confirmRegistration(confirmPricing(row, 1, now), '2026-11-23')
    const existing = { ...draft, rows: [completed] }
    const before = structuredClone(existing)
    expect(() => prepareDraftSave(blankDraft(), undefined, { deleteCompletedRowIds: [completed.id] })).toThrow('저장된 등록완료')
    expect(() => prepareDraftSave(blankDraft(), existing, { deleteCompletedRowIds: [completed.id, completed.id] })).toThrow('중복')
    expect(() => prepareDraftSave(blankDraft(), existing, { deleteCompletedRowIds: [completed.id, 'not-in-this-draft'] })).toThrow('찾을 수 없습니다')
    expect(existing).toEqual(before)
  })

  it.each(['pricing', 'information'] as const)('uses the saved %s state rather than a forged completion when authorizing deletion', (stage) => {
    const { row, draft } = fixture()
    const savedRow = stage === 'information' ? confirmPricing(row, 1, now) : row
    const incoming = { ...draft, rows: [{ ...savedRow, stage: 'registered' as const, registrationCompletedAt: '2026-11-23' }] }
    expect(() => prepareDraftSave(incoming, { ...draft, rows: [savedRow] }, { deleteCompletedRowIds: [row.id] })).toThrow('등록완료 상품만')
  })

  it.each(['queued', 'running', 'login_required', 'succeeded'] as const)('rejects explicit deletion of %s work and preserves its receipt and assets', (status) => {
    const { row, draft: existing } = lockedFixture(status)
    const before = structuredClone(existing)
    expect(() => prepareDraftSave(blankDraft(), existing, { deleteCompletedRowIds: [row.id] })).toThrow('삭제할 수 없습니다')
    expect(existing).toEqual(before)
    expect(prepareDraftSave(blankDraft(), existing).rows).toEqual([row])
  })

  it('preserves locked data without silently exceeding saved-draft limits', () => {
    const { draft: existing } = lockedFixture('queued')
    const { row, draft } = fixture()
    expect(() => prepareDraftSave({ ...draft, rows: Array.from({ length: 500 }, (_, index) => ({ ...row, id: `new-${index}` })) }, existing)).toThrow('최대 500개')
    expect(() => prepareDraftSave({ ...draft, rows: [], labels: Array.from({ length: 100 }, (_, index) => ({ name: `new-label-${index}.jpg`, data: 'label' })) }, existing)).toThrow('작업을 나눠')
  })
})
