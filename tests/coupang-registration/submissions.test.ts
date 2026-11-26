// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import JSZip from 'jszip'

const mocks = vi.hoisted(() => ({ execute: vi.fn(), transaction: vi.fn(), txExecute: vi.fn(), load: vi.fn(), ensure: vi.fn(), archive: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: { execute: mocks.execute, transaction: mocks.transaction } }))
vi.mock('@/lib/coupang-registration/store', () => ({ loadDraft: mocks.load, ensureCoupangDrafts: mocks.ensure }))
vi.mock('@/lib/coupang-registration/excel', () => ({ buildRegistrationArchive: mocks.archive }))

import { assertCompletedEvidence, getSubmissions, recordSubmissionEvent, RegistrationConflict, submitRegistration, type SubmissionEvent } from '@/lib/coupang-registration/submissions'
import { applyRegistrationSubmission, AS_CONTACT_DEFAULT, AS_CONTACT_FIELD, blankDraft, confirmPricing, createRegistrationRow, getRegistrationStage, SEARCH_TAGS_FIELD, WARRANTY_DEFAULT, WARRANTY_FIELD, type RegistrationDraft } from '@/lib/coupang-registration/model'

const workspace = '7c3ff1ad-3b8c-4fa1-9efe-961b048694c0'
const draftId = 'f7b209a8-a3d7-41c5-b445-8d87e7a39f5d'
const jobId = '9bcd6c67-d737-44f7-9a65-c702d4b1d58c'
const token = 'a'.repeat(48)
const createdAt = '2026-11-23T07:00:00.000Z'
const observedAt = '2026-11-23T07:05:00.000Z'
const dialect = new PgDialect()
const query = (statement: SQL) => dialect.sqlToQuery(statement)

function fixture(): RegistrationDraft {
  const row = confirmPricing({ ...createRegistrationRow(), id: 'row-1', name: '샘플 옵션', templateId: 'template-1', sheetName: 'QF_test', priceMode: 'manual', manualSupplyPrice: 1000, saleMode: 'manual', manualSalePrice: 2000,
    fields: { [SEARCH_TAGS_FIELD]: '샘플,옵션', [WARRANTY_FIELD]: WARRANTY_DEFAULT, [AS_CONTACT_FIELD]: AS_CONTACT_DEFAULT },
  }, 1, createdAt)
  return {
    ...blankDraft(), rows: [row],
    templates: [{ id: 'template-1', name: 'template.xlsx', file: { name: 'template.xlsx', data: '' }, sheets: [{ name: 'QF_test', columns: ['상품명', '공급가', '쿠팡 판매가'].map((label, index) => ({ column: index + 1, label, requirement: '필수', guide: '' })) }] }],
  }
}
function completedEvent(snapshot = fixture()): SubmissionEvent {
  return {
    draftId, jobId, token, status: 'succeeded', message: '상품 검수 완료', receiptId: 'quote-123', receiptUrl: 'https://supplier.coupang.com/qvt/wims',
    completedAt: observedAt,
    evidence: { workbookName: `Funtastic-${jobId}.xlsx`, quoteId: 'quote-123', observedAt, products: snapshot.rows.map((row, index) => ({ name: row.name, skuId: String(100001 + index), status: '상품 검수 완료' })) },
  }
}
function storedJob(snapshot = fixture()) {
  return {
    id: jobId, draftId, token, snapshot, status: 'queued', message: '연결 대기', createdAt,
    transfer: { jobId, token, files: [{ name: `Funtastic-${jobId}.xlsx`, data: Buffer.from('immutable-workbook').toString('base64'), kind: 'workbook' as const }], rows: snapshot.rows.map((row) => ({ id: row.id, name: row.name })) },
  }
}

beforeEach(async () => {
  vi.clearAllMocks()
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse(observedAt))
  mocks.execute.mockResolvedValue([])
  mocks.txExecute.mockResolvedValue([])
  mocks.transaction.mockImplementation(async (work) => work({ execute: mocks.txExecute }))
  const archive = new JSZip()
  archive.file('견적서/template_등록용.xlsx', 'template-bytes')
  mocks.archive.mockResolvedValue(await archive.generateAsync({ type: 'nodebuffer' }))
})

describe('Supplier Hub completion evidence', () => {
  it('accepts only all exact products with real numeric SKU identifiers for this workbook and quote', () => {
    const snapshot = fixture()
    expect(() => assertCompletedEvidence(snapshot, jobId, completedEvent(snapshot), createdAt)).not.toThrow()
    const malformed = completedEvent(snapshot)
    malformed.evidence!.workbookName = 'another-job.xlsx'
    expect(() => assertCompletedEvidence(snapshot, jobId, malformed, createdAt)).toThrow('현재 견적서')
    malformed.evidence!.workbookName = `Funtastic-${jobId}.xlsx`
    malformed.evidence!.quoteId = 'different-quote'
    expect(() => assertCompletedEvidence(snapshot, jobId, malformed, createdAt)).toThrow('현재 견적서')
  })

  it('does not accept upload/validation alone, missing SKU, another product or only partial results', () => {
    const snapshot = fixture()
    for (const product of [
      { name: snapshot.rows[0].name, status: '업로드 완료', skuId: '123' },
      { name: snapshot.rows[0].name, status: '상품 검수 완료', skuId: '' },
      { name: snapshot.rows[0].name, status: '상품 검수 완료', skuId: '0' },
      { name: snapshot.rows[0].name, status: '상품 검수 완료', skuId: '00001' },
      { name: snapshot.rows[0].name, status: '상품 검수 완료', skuId: '상품ID-123' },
      { name: '다른 상품', status: '상품 검수 완료', skuId: '123' },
    ]) {
      const event = completedEvent(snapshot)
      event.evidence!.products = [product]
      expect(() => assertCompletedEvidence(snapshot, jobId, event, createdAt)).toThrow('검수완료와 SKU')
    }
    const event = completedEvent(snapshot)
    event.evidence!.products = []
    expect(() => assertCompletedEvidence(snapshot, jobId, event, createdAt)).toThrow('모든 상품')
    const duplicate = fixture()
    duplicate.rows.push({ ...duplicate.rows[0], id: 'row-2', name: '둘째 상품' })
    const repeated = completedEvent(duplicate)
    repeated.evidence!.products[1].name = repeated.evidence!.products[0].name
    expect(() => assertCompletedEvidence(duplicate, jobId, repeated, createdAt)).toThrow('모든 상품')
    const sameSku = completedEvent(duplicate)
    sameSku.evidence!.products[1].skuId = sameSku.evidence!.products[0].skuId
    expect(() => assertCompletedEvidence(duplicate, jobId, sameSku, createdAt)).toThrow('서로 다른')
  })

  it('rejects stale/future observations and results from another destination', () => {
    const snapshot = fixture()
    for (const timestamp of ['2026-11-23T06:59:59.000Z', '2026-11-23T07:10:00.000Z']) {
      const event = completedEvent(snapshot)
      event.evidence!.observedAt = timestamp
      expect(() => assertCompletedEvidence(snapshot, jobId, event, createdAt)).toThrow('확인시각')
    }
    const event = completedEvent(snapshot)
    event.receiptUrl = 'https://example.com/qvt/wims'
    expect(() => assertCompletedEvidence(snapshot, jobId, event, createdAt)).toThrow('결과 주소')
  })
})

describe('workspace submission reservations', () => {
  it('reserves ready information rows atomically under the canonical workspace', async () => {
    const snapshot = fixture()
    mocks.load.mockResolvedValue({ id: draftId, revision: 1, payload: snapshot })
    mocks.txExecute.mockImplementation(async (statement: SQL) => query(statement).sql.startsWith('SELECT id, revision') ? [{ id: draftId, revision: 1, payload: snapshot }] : [])
    const result = await submitRegistration(workspace, draftId, 1, ['row-1'])
    expect(result.revision).toBe(2)
    expect(result.payload.rows[0].submission?.status).toBe('queued')
    expect(getRegistrationStage(result.payload.rows[0])).toBe('information')
    expect(result.transfer.files[0].name).toBe(`Funtastic-${result.submission.jobId}.xlsx`)
    expect(mocks.load).toHaveBeenCalledWith(workspace, draftId)
    const statements = mocks.txExecute.mock.calls.map(([statement]) => query(statement))
    expect(statements.filter((statement) => statement.sql.startsWith('INSERT INTO coupang_registration_submissions'))).toHaveLength(1)
    const insertion = statements.find((statement) => statement.sql.startsWith('INSERT INTO coupang_registration_submissions'))!
    expect(insertion.sql).toContain('snapshot,transfer,status')
    expect(insertion.params).toContain(JSON.stringify(result.transfer))
    expect(statements.filter((statement) => !statement.sql.includes('pg_advisory_xact_lock')).every((statement) => statement.params.includes(workspace))).toBe(true)
    expect(statements.find((statement) => statement.sql.includes('pg_advisory_xact_lock'))?.params).toContain(`coupang-registration:${workspace}`)
  })

  it('returns the same active submission when the same selection is clicked twice', async () => {
    const snapshot = fixture()
    const activeRows = snapshot.rows.map((row) => applyRegistrationSubmission(row, { jobId, status: 'queued', requestedAt: createdAt }))
    mocks.load.mockResolvedValue({ id: draftId, revision: 2, payload: { ...snapshot, rows: activeRows } })
    mocks.execute.mockImplementation(async (statement: SQL) => query(statement).sql.startsWith('SELECT') ? [storedJob(snapshot)] : [])
    const result = await submitRegistration(workspace, draftId, 2, ['row-1'])
    expect(result.submission.jobId).toBe(jobId)
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('returns byte-identical persisted attachments on later status checks even when quote metadata changes', async () => {
    const snapshot = fixture()
    const job = storedJob(snapshot)
    mocks.load.mockResolvedValue({ id: draftId, revision: 2, payload: snapshot })
    mocks.execute.mockImplementation(async (statement: SQL) => query(statement).sql.startsWith('SELECT') ? [job] : [])
    const first = await getSubmissions(workspace, draftId)
    Object.assign(job, { status: 'running', message: '견적서 검증 완료', receiptId: 'quote-123', receiptUrl: 'https://supplier.coupang.com/qvt/wims' })
    const second = await getSubmissions(workspace, draftId)
    expect(first.transfers).toEqual(second.transfers)
    expect(JSON.stringify(first.transfers[0])).toBe(JSON.stringify(second.transfers[0]))
    expect(second.transfers[0].files[0].data).toBe(Buffer.from('immutable-workbook').toString('base64'))
    expect(second.transfers[0]).not.toHaveProperty('receiptId')
    expect(mocks.archive).not.toHaveBeenCalled()
  })

  it('freezes legacy transfer bytes once under workspace scope and reuses the database winner', async () => {
    const snapshot = fixture()
    const job = { ...storedJob(snapshot), transfer: null }
    let stored: ReturnType<typeof storedJob>['transfer'] | null = null
    mocks.load.mockResolvedValue({ id: draftId, revision: 2, payload: snapshot })
    mocks.execute.mockImplementation(async (statement: SQL) => {
      const statementQuery = query(statement)
      if (statementQuery.sql.startsWith('SELECT')) return [{ ...job, transfer: stored }]
      if (statementQuery.sql.includes('SET transfer=COALESCE')) {
        expect(statementQuery.params).toContain(workspace)
        expect(statementQuery.params).toContain(draftId)
        expect(statementQuery.params).toContain(jobId)
        stored ??= JSON.parse(statementQuery.params[0] as string)
        return [{ transfer: stored }]
      }
      return []
    })
    const first = await getSubmissions(workspace, draftId)
    const second = await getSubmissions(workspace, draftId)
    expect(first.transfers).toEqual(second.transfers)
    expect(mocks.archive).toHaveBeenCalledTimes(1)
    expect(mocks.execute.mock.calls.filter(([statement]) => query(statement).sql.includes('SET transfer=COALESCE'))).toHaveLength(1)
  })

  it('rejects a concurrent revision change before any submission is inserted', async () => {
    const snapshot = fixture()
    mocks.load.mockResolvedValue({ id: draftId, revision: 1, payload: snapshot })
    mocks.txExecute.mockImplementation(async (statement: SQL) => query(statement).sql.startsWith('SELECT id, revision') ? [{ id: draftId, revision: 2, payload: snapshot }] : [])
    await expect(submitRegistration(workspace, draftId, 1, ['row-1'])).rejects.toBeInstanceOf(RegistrationConflict)
    expect(mocks.txExecute.mock.calls.some(([statement]) => query(statement).sql.startsWith('INSERT'))).toBe(false)
  })

  it('blocks a second draft while this workspace already has an active Supplier Hub job', async () => {
    const snapshot = fixture()
    mocks.load.mockResolvedValue({ id: draftId, revision: 1, payload: snapshot })
    mocks.txExecute.mockImplementation(async (statement: SQL) => query(statement).sql.startsWith('SELECT id FROM coupang_registration_submissions') ? [{ id: 'another-active-job' }] : [])
    await expect(submitRegistration(workspace, draftId, 1, ['row-1'])).rejects.toThrow('한 번에 한 작업')
    expect(mocks.txExecute.mock.calls.some(([statement]) => query(statement).sql.startsWith('INSERT'))).toBe(false)
  })

  it('never enqueues rows that have not confirmed their prices or do not belong to the draft', async () => {
    const snapshot = fixture()
    mocks.load.mockResolvedValue({ id: draftId, revision: 1, payload: snapshot })
    await expect(submitRegistration(workspace, draftId, 1, ['another-row'])).rejects.toThrow('정확히 선택')
    mocks.load.mockResolvedValue({ id: draftId, revision: 1, payload: { ...snapshot, rows: [{ ...snapshot.rows[0], stage: 'pricing' }] } })
    await expect(submitRegistration(workspace, draftId, 1, ['row-1'])).rejects.toThrow('판매가확정')
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('requires the workspace-owned job token before accepting browser events', async () => {
    const snapshot = fixture()
    mocks.txExecute.mockImplementation(async (statement: SQL) => query(statement).sql.startsWith('SELECT id, revision') ? [{ id: draftId, revision: 2, payload: snapshot }] : [storedJob(snapshot)])
    await expect(recordSubmissionEvent(workspace, { ...completedEvent(snapshot), token: 'b'.repeat(48) })).rejects.toThrow('확인할 수 없습니다')
    const statements = mocks.txExecute.mock.calls.map(([statement]) => query(statement))
    expect(statements).toHaveLength(2)
    expect(statements.every((statement) => statement.params.includes(workspace))).toBe(true)
    expect(statements.some((statement) => statement.sql.startsWith('UPDATE'))).toBe(false)
  })
})
