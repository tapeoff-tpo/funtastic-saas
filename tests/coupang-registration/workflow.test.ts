// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  applyRegistrationSubmission, calculatePrice, confirmPricing, createRegistrationRow, getEditableRegistrationColumns,
  getRegistrationStage, isAutomaticTemplateColumn, priceIssues, returnToPricing, rowIssues, blankDraft,
  type RegistrationRow, type RegistrationSubmission,
} from '@/lib/coupang-registration/model'
import { rowSchema, submissionSchema } from '@/lib/coupang-registration/schema'

const now = '2026-11-23T07:00:00.000Z'
const completedAt = '2026-11-23T07:05:00.000Z'
function pricedRow(): RegistrationRow {
  return { ...createRegistrationRow(), name: '샘플 옵션', priceMode: 'manual', manualSupplyPrice: 1000, saleMode: 'manual', manualSalePrice: 1500, fields: { 제조국: '중국' } }
}
const queued: RegistrationSubmission = { status: 'queued', jobId: 'job-1', requestedAt: now }
const succeeded: RegistrationSubmission = { status: 'succeeded', jobId: 'job-1', completedAt, receiptId: 'supplier-receipt-1', receiptUrl: 'https://supplier.coupang.com/qvt/registration' }

describe('Coupang three-stage registration workflow', () => {
  it('keeps old saved rows in pricing even when they already have automatic prices', () => {
    const { stage, ...legacy } = pricedRow()
    expect(stage).toBe('pricing')
    expect(getRegistrationStage(legacy)).toBe('pricing')
    expect(rowSchema.parse(legacy).stage).toBe('pricing')
  })

  it('confirms prices before category, labels and registration fields are complete', () => {
    const row = pricedRow()
    expect(priceIssues(row)).toEqual([])
    expect(rowIssues(row, blankDraft())).toContain('카테고리 엑셀을 업로드하고 해당 양식을 선택해주세요.')
    const confirmed = confirmPricing(row, 1, now)
    expect(confirmed).toMatchObject({ stage: 'information', priceConfirmedAt: now, fields: row.fields })
    expect(getRegistrationStage(confirmed)).toBe('information')
    expect(rowSchema.parse(confirmed).priceConfirmedAt).toBe(now)
  })

  it('does not advance invalid supply or retail prices', () => {
    expect(() => confirmPricing({ ...pricedRow(), manualSupplyPrice: null })).toThrow('공급가')
    expect(() => confirmPricing({ ...pricedRow(), manualSalePrice: null })).toThrow('판매가')
    expect(() => confirmPricing({ ...pricedRow(), manualSalePrice: 999 })).toThrow('공급가 이상')
  })

  it('freezes confirmed automatic prices so another pricing row cannot change them through rounding', () => {
    const row = { ...pricedRow(), priceMode: 'wholesale' as const, wholesalePrice: 1000, saleMode: 'auto' as const }
    const confirmed = confirmPricing(row, 100, now)
    expect(calculatePrice(confirmed, 1).sale).toBe(1700)
    expect(calculatePrice(confirmed, 1000).sale).toBe(1700)
    expect(confirmed).toMatchObject({ priceMode: 'manual', manualSupplyPrice: 1000, saleMode: 'manual', manualSalePrice: 1700 })
  })

  it('returns an unsubmitted product to pricing without dropping its entered registration data', () => {
    const row = returnToPricing(confirmPricing(pricedRow(), 1, now))
    expect(getRegistrationStage(row)).toBe('pricing')
    expect(row.priceConfirmedAt).toBeUndefined()
    expect(row.fields).toEqual({ 제조국: '중국' })
    expect(row.manualSalePrice).toBe(1500)
  })

  it('keeps queued, running, login-required and failed submissions out of completed products', () => {
    const row = applyRegistrationSubmission(confirmPricing(pricedRow(), 1, now), queued)
    expect(getRegistrationStage(row)).toBe('information')
    expect(() => returnToPricing(row)).toThrow('진행 중')
    expect(() => confirmPricing(row)).toThrow('진행 중')
    for (const status of ['running', 'login_required', 'failed'] as const) {
      const updated = applyRegistrationSubmission(row, { ...queued, status })
      expect(getRegistrationStage(updated)).toBe('information')
      expect(updated.registeredAt).toBeUndefined()
    }
  })

  it('preserves matching legacy Hub receipts without adding products to the manually completed list', () => {
    const confirmed = confirmPricing(pricedRow(), 1, now)
    expect(() => applyRegistrationSubmission(confirmed, succeeded)).toThrow('일치하지 않는')
    const row = applyRegistrationSubmission(confirmed, queued)
    expect(() => applyRegistrationSubmission(row, { ...succeeded, receiptId: undefined, receiptUrl: undefined })).toThrow('확인번호')
    expect(() => applyRegistrationSubmission(row, { ...succeeded, jobId: 'stale-job' })).toThrow('일치하지 않는')
    const registered = applyRegistrationSubmission(row, succeeded)
    expect(getRegistrationStage(registered)).toBe('information')
    expect(registered.registeredAt).toBe(completedAt)
    expect(applyRegistrationSubmission(registered, succeeded)).toBe(registered)
    expect(() => returnToPricing(registered)).toThrow('등록완료')
    expect(() => confirmPricing(registered)).toThrow('등록완료')
  })

  it('allows an explicit retry after failure while rejecting stale previous-job results', () => {
    const row = applyRegistrationSubmission(confirmPricing(pricedRow(), 1, now), queued)
    const failed = applyRegistrationSubmission(row, { ...queued, status: 'failed', message: '양식 검증 실패' })
    const retry = applyRegistrationSubmission(failed, { ...queued, jobId: 'job-2' })
    expect(retry.submission?.jobId).toBe('job-2')
    expect(() => applyRegistrationSubmission(retry, succeeded)).toThrow('일치하지 않는')
  })

  it('does not trust a manually toggled registered stage without a successful result', () => {
    expect(getRegistrationStage({ ...pricedRow(), stage: 'registered' })).toBe('pricing')
    expect(getRegistrationStage({ ...confirmPricing(pricedRow(), 1, now), stage: 'registered', submission: queued })).toBe('information')
    expect(submissionSchema.safeParse({ ...succeeded, receiptUrl: 'javascript:alert(1)' }).success).toBe(false)
    expect(submissionSchema.safeParse({ ...succeeded, receiptUrl: 'https://example.com/fake' }).success).toBe(false)
    expect(submissionSchema.safeParse({ ...succeeded, receiptUrl: 'not a URL' }).success).toBe(false)
  })

  it('recognizes automatic template fields for new and old draft metadata', () => {
    const columns = [
      { column: 1, label: '고시명', requirement: '필수', guide: '' },
      { column: 2, label: '자동 계산', requirement: '필수', guide: '', autoGenerated: true },
      { column: 3, label: '제조국', requirement: '필수', guide: '' },
    ]
    expect(isAutomaticTemplateColumn(columns[0])).toBe(true)
    expect(getEditableRegistrationColumns(columns).map((column) => column.label)).toEqual(['제조국'])
  })
})
