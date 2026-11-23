import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { sql } from 'drizzle-orm'
import JSZip from 'jszip'
import { z } from 'zod'
import { db } from '@/lib/db'
import { ensureCoupangDrafts, loadDraft } from './store'
import { buildRegistrationArchive } from './excel'
import { applyRegistrationSubmission, getRegistrationStage, rowIssues, type RegistrationDraft, type RegistrationSubmission } from './model'
import type { SupplierRegistrationJob } from './supplier-bridge'

const resultRows = <T>(result: unknown): T[] => Array.isArray(result) ? result as T[] : (result as { rows?: T[] }).rows ?? []
type Job = { id: string; draftId: string; token: string; snapshot: RegistrationDraft; transfer?: SupplierRegistrationJob | null; status: RegistrationSubmission['status']; message: string; receiptId?: string | null; receiptUrl?: string | null; createdAt: string; completedAt?: string | null }
type StoredDraft = { id: string; revision: number; payload: RegistrationDraft }
export class RegistrationConflict extends Error {}

async function ensureSubmissions() {
  await ensureCoupangDrafts()
  await db.execute(sql`CREATE TABLE IF NOT EXISTS coupang_registration_submissions (
    id uuid PRIMARY KEY, user_id uuid NOT NULL, draft_id uuid NOT NULL,
    bridge_token text NOT NULL, snapshot jsonb NOT NULL, transfer jsonb, status text NOT NULL DEFAULT 'queued',
    message text NOT NULL DEFAULT '', receipt_id text, receipt_url text,
    evidence jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
  )`)
  await db.execute(sql`ALTER TABLE coupang_registration_submissions ADD COLUMN IF NOT EXISTS transfer jsonb`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS coupang_registration_submission_workspace ON coupang_registration_submissions(user_id, draft_id, created_at DESC)`)
  await db.execute(sql`ALTER TABLE coupang_registration_submissions ENABLE ROW LEVEL SECURITY`)
}

function publicJob(job: Job) {
  return { jobId: job.id, status: job.status, message: job.message, requestedAt: job.createdAt, receiptId: job.receiptId, receiptUrl: job.receiptUrl, completedAt: job.completedAt, rowIds: job.snapshot.rows.map((row) => row.id) }
}

const jobColumns = sql`id, draft_id::text AS "draftId", bridge_token AS token, snapshot, transfer, status, message, receipt_id AS "receiptId", receipt_url AS "receiptUrl", created_at::text AS "createdAt", completed_at::text AS "completedAt"`

async function createTransfer(job: Job): Promise<SupplierRegistrationJob> {
  const archive = await JSZip.loadAsync(await buildRegistrationArchive(job.snapshot))
  const files = []
  for (const file of Object.values(archive.files)) {
    if (file.dir) continue
    if (file.name.startsWith('견적서/') && file.name.endsWith('.xlsx')) {
      files.push({ name: `Funtastic-${job.id}.xlsx`, data: await file.async('base64'), kind: 'workbook' as const })
    } else if (file.name.startsWith('품질표시/')) {
      files.push({ name: file.name.split('/').pop()!, data: await file.async('base64'), kind: 'label' as const })
    }
  }
  if (files.filter((file) => file.kind === 'workbook').length !== 1) throw new Error('자동등록은 한 번에 견적서 1개씩 선택해주세요.')
  return { jobId: job.id, token: job.token, files, rows: job.snapshot.rows.map((row) => ({ id: row.id, name: row.name })) }
}

async function transferJob(job: Job, workspace: string): Promise<SupplierRegistrationJob> {
  if (job.transfer) return job.transfer
  // A workbook's ZIP timestamps change when ExcelJS writes it again. Persist the
  // exact first transfer for older jobs too, so retries cannot change file bytes.
  const generated = await createTransfer(job)
  const stored = resultRows<{ transfer: SupplierRegistrationJob }>(await db.execute(sql`
    UPDATE coupang_registration_submissions SET transfer=COALESCE(transfer,${JSON.stringify(generated)}::jsonb)
    WHERE user_id=${workspace}::uuid AND draft_id=${job.draftId}::uuid AND id=${job.id}::uuid RETURNING transfer
  `))[0]
  if (!stored?.transfer) throw new Error('상품등록 첨부파일을 고정하지 못했습니다. 작업을 다시 확인해주세요.')
  job.transfer = stored.transfer
  return stored.transfer
}

export async function getSubmissions(workspace: string, draftId: string) {
  await ensureSubmissions()
  const draft = await loadDraft(workspace, draftId)
  if (!draft) throw new Error('저장된 작업을 찾을 수 없습니다.')
  const jobs = resultRows<Job>(await db.execute(sql`SELECT ${jobColumns} FROM coupang_registration_submissions WHERE user_id=${workspace}::uuid AND draft_id=${draftId}::uuid ORDER BY created_at DESC LIMIT 30`))
  const active = jobs.filter((job) => ['queued', 'running', 'login_required'].includes(job.status))
  const transfers = await Promise.all(active.map((job) => transferJob(job, workspace)))
  return { ...draft, submissions: jobs.map(publicJob), transfers }
}

export async function submitRegistration(workspace: string, draftId: string, revision: number, rowIds: string[]) {
  await ensureSubmissions()
  const loaded = await loadDraft(workspace, draftId)
  if (!loaded || loaded.revision !== revision) throw new RegistrationConflict('저장된 작업이 변경됐습니다. 최신 작업을 다시 불러와주세요.')
  const selected = loaded.payload.rows.filter((row) => rowIds.includes(row.id))
  if (!selected.length || selected.length !== new Set(rowIds).size) throw new Error('등록할 상품을 정확히 선택해주세요.')
  if (selected.some((row) => getRegistrationStage(row) !== 'information')) throw new Error('판매가확정을 완료한 상품만 등록할 수 있습니다.')
  if (new Set(selected.map((row) => row.templateId)).size !== 1) throw new Error('자동등록은 한 번에 견적서 1개씩 선택해주세요.')
  if (new Set(selected.map((row) => row.name.trim())).size !== selected.length) throw new Error('같은 등록 상품명이 있습니다. 옵션을 포함해 상품명을 구분해주세요.')
  const activeIds = new Set(selected.map((row) => row.submission?.jobId).filter(Boolean))
  if (selected.some((row) => row.submission && ['queued', 'running', 'login_required'].includes(row.submission.status))) {
    if (activeIds.size === 1) {
      const active = resultRows<Job>(await db.execute(sql`SELECT ${jobColumns} FROM coupang_registration_submissions WHERE user_id=${workspace}::uuid AND draft_id=${draftId}::uuid AND id=${[...activeIds][0]}::uuid`))[0]
      if (active && active.snapshot.rows.length === selected.length && active.snapshot.rows.every((row) => rowIds.includes(row.id))) return { ...loaded, submission: publicJob(active), transfer: await transferJob(active, workspace) }
    }
    throw new RegistrationConflict('선택 상품의 등록이 이미 진행 중입니다. 등록 상태를 확인해주세요.')
  }
  const snapshot: RegistrationDraft = { ...loaded.payload, rows: selected }
  for (const row of selected) {
    const issues = rowIssues(row, snapshot)
    if (issues.length) throw new Error(`${row.name}: ${issues.slice(0, 3).join(', ')}`)
  }
  const now = new Date().toISOString()
  const job: Job = { id: randomUUID(), draftId, token: randomBytes(24).toString('hex'), snapshot, status: 'queued', message: '서플라이어허브 연결 대기', createdAt: now }
  // Parse the original file and verify all required fields before reserving any rows.
  const transfer = await createTransfer(job)
  job.transfer = transfer
  if (Buffer.byteLength(JSON.stringify({ payload: loaded.payload, transfer })) > 4_000_000) throw new Error('견적서와 품질표시 용량이 큽니다. 작업을 나눠 저장한 뒤 등록해주세요.')
  const saved = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`coupang-registration:${workspace}`},0))`)
    const ongoing = resultRows<{ id: string }>(await tx.execute(sql`SELECT id FROM coupang_registration_submissions WHERE user_id=${workspace}::uuid AND status IN ('queued','running','login_required') LIMIT 1`))[0]
    if (ongoing) throw new RegistrationConflict('진행 중인 쿠팡 등록 작업을 먼저 확인해주세요. 한 번에 한 작업씩 등록합니다.')
    const current = resultRows<StoredDraft>(await tx.execute(sql`SELECT id, revision, payload FROM coupang_registration_drafts WHERE user_id=${workspace}::uuid AND id=${draftId}::uuid FOR UPDATE`))[0]
    if (!current || current.revision !== revision) throw new RegistrationConflict('다른 사용자가 수정한 작업입니다. 최신 작업을 다시 불러와주세요.')
    const payload = { ...current.payload, rows: current.payload.rows.map((row) => rowIds.includes(row.id) ? applyRegistrationSubmission(row, { jobId: job.id, status: 'queued', requestedAt: now, message: job.message }) : row) }
    await tx.execute(sql`INSERT INTO coupang_registration_submissions(id,user_id,draft_id,bridge_token,snapshot,transfer,status,message) VALUES(${job.id}::uuid,${workspace}::uuid,${draftId}::uuid,${job.token},${JSON.stringify(snapshot)}::jsonb,${JSON.stringify(transfer)}::jsonb,'queued',${job.message})`)
    await tx.execute(sql`UPDATE coupang_registration_drafts SET payload=${JSON.stringify(payload)}::jsonb, revision=revision+1, updated_at=now() WHERE user_id=${workspace}::uuid AND id=${draftId}::uuid`)
    return { id: draftId, revision: revision + 1, payload }
  })
  return { ...saved, submission: publicJob(job), transfer }
}

export const submissionEventSchema = z.object({
  draftId: z.uuid(), jobId: z.uuid(), token: z.string().regex(/^[a-f0-9]{48}$/),
  status: z.enum(['running', 'login_required', 'failed', 'succeeded']), message: z.string().max(2000),
  receiptId: z.string().min(1).max(500).optional(), receiptUrl: z.string().url().max(2000).refine((value) => {
    try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'supplier.coupang.com' && !url.username && !url.password } catch { return false }
  }, '서플라이어허브 결과 주소만 사용할 수 있습니다.').optional(),
  completedAt: z.string().datetime({ offset: true }).optional(),
  evidence: z.object({ workbookName: z.string().min(1).max(250), quoteId: z.string().min(1).max(500), observedAt: z.string().datetime({ offset: true }), products: z.array(z.object({ name: z.string().max(500), skuId: z.string().max(100), status: z.string().max(100) })).max(500) }).optional(),
})
export type SubmissionEvent = z.infer<typeof submissionEventSchema>

export function assertCompletedEvidence(snapshot: RegistrationDraft, jobId: string, event: SubmissionEvent, createdAt: string) {
  const evidence = event.evidence
  if (!evidence || evidence.workbookName !== `Funtastic-${jobId}.xlsx` || evidence.quoteId !== event.receiptId) throw new Error('현재 견적서에 대한 쿠팡 검수 결과가 필요합니다.')
  if (event.receiptUrl && !/^https:\/\/supplier\.coupang\.com\/qvt\/wims(?:[?#]|$)/.test(event.receiptUrl)) throw new Error('등록 결과 주소가 올바르지 않습니다.')
  const observed = Date.parse(evidence.observedAt)
  if (observed < Date.parse(createdAt) || observed > Date.now() + 60_000) throw new Error('등록 결과 확인시각이 올바르지 않습니다.')
  if (evidence.products.length !== snapshot.rows.length || new Set(evidence.products.map((product) => product.name)).size !== snapshot.rows.length) throw new Error('선택한 모든 상품의 검수 결과가 필요합니다.')
  if (new Set(evidence.products.map((product) => product.skuId)).size !== snapshot.rows.length) throw new Error('상품별로 서로 다른 쿠팡 SKU가 확인되어야 합니다.')
  for (const row of snapshot.rows) {
    const product = evidence.products.find((item) => item.name === row.name)
    if (!product || product.status !== '상품 검수 완료' || !/^[1-9]\d*$/.test(product.skuId)) throw new Error(`${row.name}: 쿠팡 검수완료와 SKU가 아직 확인되지 않았습니다.`)
  }
}

export async function recordSubmissionEvent(workspace: string, event: SubmissionEvent) {
  await ensureSubmissions()
  await db.transaction(async (tx) => {
    // Always lock the draft first, matching submitRegistration's order.
    const current = resultRows<StoredDraft>(await tx.execute(sql`SELECT id, revision, payload FROM coupang_registration_drafts WHERE user_id=${workspace}::uuid AND id=${event.draftId}::uuid FOR UPDATE`))[0]
    const job = resultRows<Job>(await tx.execute(sql`SELECT ${jobColumns} FROM coupang_registration_submissions WHERE user_id=${workspace}::uuid AND draft_id=${event.draftId}::uuid AND id=${event.jobId}::uuid FOR UPDATE`))[0]
    if (!job || !current || job.token.length !== event.token.length || !timingSafeEqual(Buffer.from(job.token), Buffer.from(event.token))) throw new Error('상품등록 작업을 확인할 수 없습니다.')
    if (job.status === 'succeeded' || job.status === 'failed') return
    if (event.status === 'succeeded') assertCompletedEvidence(job.snapshot, job.id, event, job.createdAt)
    const now = new Date().toISOString()
    const result: RegistrationSubmission = { jobId: job.id, status: event.status, message: event.message, requestedAt: new Date(job.createdAt).toISOString(), receiptId: event.receiptId ?? job.receiptId ?? undefined, receiptUrl: event.receiptUrl ?? job.receiptUrl ?? undefined, completedAt: event.status === 'succeeded' ? now : undefined }
    const rowIds = new Set(job.snapshot.rows.map((row) => row.id))
    const payload = { ...current.payload, rows: current.payload.rows.map((row) => rowIds.has(row.id) ? applyRegistrationSubmission(row, result) : row) }
    await tx.execute(sql`UPDATE coupang_registration_submissions SET status=${result.status}, message=${result.message ?? ''}, receipt_id=${result.receiptId ?? null}, receipt_url=${result.receiptUrl ?? null}, evidence=${JSON.stringify(event.evidence ?? null)}::jsonb, completed_at=${result.completedAt ?? null}::timestamptz, updated_at=now() WHERE id=${job.id}::uuid AND user_id=${workspace}::uuid`)
    await tx.execute(sql`UPDATE coupang_registration_drafts SET payload=${JSON.stringify(payload)}::jsonb, revision=revision+1, updated_at=now() WHERE id=${event.draftId}::uuid AND user_id=${workspace}::uuid`)
  })
  return getSubmissions(workspace, event.draftId)
}
