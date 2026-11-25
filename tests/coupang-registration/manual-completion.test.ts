// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { prepareDraftSave } from '@/lib/coupang-registration/draft-workflow'
import {
  applyRegistrationSubmission, blankDraft, calculatePrice, confirmPricing, confirmRegistration,
  createRegistrationRow, getRegistrationDate, getRegistrationStage, isRegistrationDate, reopenRegistration,
  type RegistrationDraft, type RegistrationRow,
} from '@/lib/coupang-registration/model'
import { rowSchema } from '@/lib/coupang-registration/schema'

const addedAt = '2026-11-23T15:30:00.000Z'
const priceConfirmedAt = '2026-11-24T15:10:00.000Z'
const completedOn = '2026-11-25'
function informationRow(): RegistrationRow {
  return confirmPricing({
    ...createRegistrationRow(), addedAt, name: '수동 등록 상품', priceMode: 'manual', manualSupplyPrice: 10000,
    saleMode: 'manual', manualSalePrice: 17000, fields: { 브랜드: '생활살림' },
  }, 1, priceConfirmedAt)
}
const draft = (row: RegistrationRow): RegistrationDraft => ({ ...blankDraft(), rows: [row] })

describe('manual registration completion', () => {
  it('adds a price-confirmed product to stage 3 only after an explicit dated check and can undo it', () => {
    const information = informationRow()
    const completed = confirmRegistration(information, completedOn)
    expect(getRegistrationStage(completed)).toBe('registered')
    expect(completed.registrationCompletedAt).toBe(completedOn)
    expect(completed.submission).toBeUndefined()
    expect(completed.registeredAt).toBeUndefined()
    expect(reopenRegistration(completed)).toEqual({ ...information, registrationCompletedAt: undefined })
    expect(getRegistrationStage(reopenRegistration(completed))).toBe('information')
    expect(information.registrationCompletedAt).toBeUndefined()
  })

  it('accepts actual calendar dates and rejects invalid, timestamp and blank completion dates', () => {
    expect(isRegistrationDate('2028-02-29')).toBe(true)
    for (const value of ['2026-02-29', '2026-11-31', '2026-13-01', '2026-1-01', `${completedOn}T00:00:00Z`, '']) {
      expect(isRegistrationDate(value)).toBe(false)
      expect(() => confirmRegistration(informationRow(), value)).toThrow('날짜')
      expect(rowSchema.safeParse({ ...informationRow(), registrationCompletedAt: value }).success).toBe(false)
    }
  })

  it('requires price confirmation and never completes an active or login-required Hub job', () => {
    const unconfirmed = { ...informationRow(), stage: 'pricing' as const, priceConfirmedAt: undefined }
    expect(() => confirmRegistration(unconfirmed, completedOn)).toThrow('판매가설정')
    expect(() => confirmRegistration({ ...unconfirmed, stage: 'information' }, completedOn)).toThrow('판매가설정')
    for (const status of ['queued', 'running', 'login_required'] as const) {
      expect(() => confirmRegistration({ ...informationRow(), submission: { status, jobId: 'in-flight' } }, completedOn)).toThrow('진행 중')
    }
  })

  it('keeps legacy Hub success in stage 2 until checked and preserves its receipt when checked or undone', () => {
    const queued = applyRegistrationSubmission(informationRow(), { status: 'queued', jobId: 'legacy-job' })
    const legacy = applyRegistrationSubmission(queued, { status: 'succeeded', jobId: 'legacy-job', completedAt: priceConfirmedAt, receiptId: 'receipt-1' })
    expect(getRegistrationStage(legacy)).toBe('information')
    const completed = confirmRegistration(legacy, completedOn)
    expect(getRegistrationStage(completed)).toBe('registered')
    expect(completed.submission).toBe(legacy.submission)
    expect(reopenRegistration(completed).submission).toBe(legacy.submission)
    expect(() => applyRegistrationSubmission(completed, { status: 'failed', jobId: 'legacy-job' })).toThrow('기존')
  })

  it('saves, changes the completion date and unchecks without changing confirmed prices or the original added date', () => {
    const information = informationRow()
    const completedDraft = prepareDraftSave(draft(confirmRegistration(information, completedOn)), draft(information))
    expect(getRegistrationStage(completedDraft.rows[0])).toBe('registered')
    const changed = prepareDraftSave(draft({ ...completedDraft.rows[0], registrationCompletedAt: '2026-11-24', addedAt: '2000-01-01T00:00:00Z' }), completedDraft)
    expect(changed.rows[0].registrationCompletedAt).toBe('2026-11-24')
    expect(changed.rows[0].addedAt).toBe(addedAt)
    const reopened = prepareDraftSave(draft(reopenRegistration(changed.rows[0])), changed)
    expect(getRegistrationStage(reopened.rows[0])).toBe('information')
    expect(reopened.rows[0].priceConfirmedAt).toBe(priceConfirmedAt)
    expect(reopened.rows[0].fields).toEqual(information.fields)
    expect(calculatePrice(reopened.rows[0])).toMatchObject({ supply: 10000, sale: 17000 })
  })

  it('rejects price changes while completed, direct jumps from pricing, and malformed save dates', () => {
    const information = informationRow()
    const completed = draft(confirmRegistration(information, completedOn))
    expect(() => prepareDraftSave(draft({ ...completed.rows[0], manualSupplyPrice: 11000 }), completed)).toThrow('판매가설정으로')
    expect(() => prepareDraftSave(draft({ ...completed.rows[0], stage: 'pricing', registrationCompletedAt: undefined }), completed)).toThrow('체크를 해제')
    expect(() => prepareDraftSave(draft({ ...completed.rows[0], registrationCompletedAt: '2026-02-30' }), completed)).toThrow('날짜')
    expect(() => prepareDraftSave(draft({ ...information, registrationCompletedAt: completedOn }), draft(information))).toThrow('날짜')
    expect(() => prepareDraftSave(completed, draft({ ...information, stage: 'pricing', priceConfirmedAt: undefined }))).toThrow('판매가설정')
  })

  it('does not manufacture Hub receipt metadata when the browser marks a product complete', () => {
    const information = informationRow()
    const forged = { status: 'succeeded' as const, jobId: 'browser-forged', completedAt: priceConfirmedAt, receiptId: 'browser-forged' }
    const saved = prepareDraftSave(draft({ ...confirmRegistration(information, completedOn), submission: forged, registeredAt: priceConfirmedAt }), draft(information))
    expect(getRegistrationStage(saved.rows[0])).toBe('registered')
    expect(saved.rows[0].submission).toBeUndefined()
    expect(saved.rows[0].registeredAt).toBeUndefined()
  })

  it('preserves a stored legacy receipt and its original product values when manually completed', () => {
    const queued = applyRegistrationSubmission(informationRow(), { status: 'queued', jobId: 'legacy-job' })
    const legacy = applyRegistrationSubmission(queued, { status: 'succeeded', jobId: 'legacy-job', completedAt: priceConfirmedAt, receiptId: 'real-receipt' })
    const incoming = { ...confirmRegistration(legacy, completedOn), name: '변조된 이름', submission: { status: 'failed' as const, jobId: 'fake' } }
    const saved = prepareDraftSave(draft(incoming), draft(legacy)).rows[0]
    expect(saved.name).toBe(legacy.name)
    expect(saved.submission).toEqual(legacy.submission)
    expect(saved.registeredAt).toBe(legacy.registeredAt)
    expect(saved.registrationCompletedAt).toBe(completedOn)
  })

  it('uses the current step date in Korea and leaves missing legacy dates blank', () => {
    const information = informationRow()
    expect(getRegistrationDate({ ...information, stage: 'pricing', priceConfirmedAt: undefined })).toBe('2026-11-24')
    expect(getRegistrationDate(information)).toBe('2026-11-25')
    expect(getRegistrationDate(confirmRegistration(information, '2026-11-20'))).toBe('2026-11-20')
    expect(getRegistrationDate({ ...information, addedAt: undefined, priceConfirmedAt: undefined, stage: 'pricing' })).toBe('')
    const { addedAt: _addedAt, registrationCompletedAt: _completedAt, ...legacy } = information
    void _addedAt; void _completedAt
    expect(rowSchema.safeParse(legacy).success).toBe(true)
  })
})
