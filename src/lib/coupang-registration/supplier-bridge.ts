export type SupplierRegistrationFile = { name: string; data: string; kind: 'workbook' | 'label' }
export type SupplierCategory = { id: string; name: string; path: string; matchedQueries: string[] }
export type SupplierRegistrationJob = {
  mode?: 'excel'
  jobId: string
  token: string
  files: SupplierRegistrationFile[]
  rows: { id: string; name: string }[]
}
export type SupplierIndividualRegistrationJob = {
  mode: 'individual'
  jobId: string
  token: string
  products: IndividualProduct[]
}
export type SupplierTransferJob = SupplierRegistrationJob | SupplierIndividualRegistrationJob
export type SupplierJobReference = { jobId: string; token: string }
export type SupplierRegistrationProgress = {
  jobId: string
  token: string
  status: 'running' | 'login_required' | 'attention_required' | 'prepared' | 'cancelled' | 'failed' | 'succeeded'
  message: string
  products?: RegistrationProductProgress[]
  receiptId?: string
  receiptUrl?: string
  completedAt?: string
  evidence?: {
    workbookName: string
    quoteId: string
    products: { name: string; skuId: string; status: string }[]
    observedAt: string
  }
}

const PAGE_SOURCE = 'funtastic-coupang-registration'
const EXTENSION_SOURCE = 'funtastic-coupang-registration-extension'
const pendingJobs = new Map<string, string>()

function trustedMessage(event: MessageEvent) {
  return event.source === window && event.origin === window.location.origin
    && event.data?.source === EXTENSION_SOURCE
}

let categoryExtensionId: string | undefined

function request(type: string, job?: SupplierTransferJob | SupplierJobReference, payload: Record<string, unknown> = {}, timeout = 5000): Promise<Record<string, unknown>> {
  if (typeof window === 'undefined') return Promise.reject(new Error('Chrome에서 쿠팡 등록 화면을 열어주세요.'))
  const requestId = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener('message', receive)
      reject(new Error('쿠팡 등록 확장에 연결하지 못했습니다. 확장을 설치하거나 새로고침해주세요.'))
    }, timeout)
    const receive = (event: MessageEvent) => {
      if (!trustedMessage(event) || event.data.type !== 'RESPONSE' || event.data.requestId !== requestId) return
      if (payload.extensionId && event.data.extensionId !== payload.extensionId) return
      window.clearTimeout(timer)
      window.removeEventListener('message', receive)
      if (event.data.ok !== true) reject(new Error(String(event.data.error || '쿠팡 등록 확장 응답을 확인하지 못했습니다. 확장과 페이지를 새로고침해주세요.')))
      else resolve(event.data)
    }
    window.addEventListener('message', receive)
    window.postMessage({ source: PAGE_SOURCE, type, requestId, ...payload, ...(job ? { job } : {}) }, window.location.origin)
  })
}

export type SupplierExtensionStatus = { connected: boolean; version?: string; supportsCategories?: boolean; supportsIndividual?: boolean; supportsJobInspection?: boolean; error?: string }

export function pingSupplierExtension(options: { requireIndividual?: boolean } = {}): Promise<SupplierExtensionStatus> {
  if (typeof window === 'undefined') return Promise.resolve({ connected: false })
  const requestId = crypto.randomUUID()
  return new Promise((resolve) => {
    let legacy: SupplierExtensionStatus | undefined
    let failure = ''
    const finish = (status: SupplierExtensionStatus) => {
      window.clearTimeout(timer)
      window.removeEventListener('message', receive)
      categoryExtensionId = status.supportsCategories ? categoryExtensionId : undefined
      resolve(status)
    }
    const timer = window.setTimeout(() => finish(legacy ?? { connected: false, ...(failure ? { error: failure } : {}) }), 5000)
    const receive = (event: MessageEvent) => {
      if (!trustedMessage(event) || event.data.type !== 'RESPONSE' || event.data.requestId !== requestId) return
      if (event.data.ok !== true) { failure = String(event.data.error || '확장 응답을 확인하지 못했습니다.'); return }
      const version = typeof event.data.version === 'string' ? event.data.version : undefined
      if (!version) return
      if (event.data.supportsCategories === true) {
        categoryExtensionId = typeof event.data.extensionId === 'string' ? event.data.extensionId : undefined
        const status = { connected: true, version, supportsCategories: true, ...(event.data.supportsIndividual === true ? { supportsIndividual: true } : {}), ...(event.data.supportsJobInspection === true ? { supportsJobInspection: true } : {}) }
        if (!options.requireIndividual || status.supportsIndividual) finish(status)
        else legacy = status
      } else legacy = { connected: true, version }
    }
    window.addEventListener('message', receive)
    window.postMessage({ source: PAGE_SOURCE, type: 'PING', requestId }, window.location.origin)
  })
}

export async function searchSupplierCategories(queries: string[]): Promise<SupplierCategory[]> {
  const terms = [...new Set(queries.map((value) => value.trim()).filter(Boolean))].slice(0, 6)
  if (!terms.length || terms.some((value) => value.length > 200)) throw new Error('카테고리 검색어를 확인해주세요.')
  const response = await request('CATEGORY_SEARCH', undefined, { queries: terms, ...(categoryExtensionId ? { extensionId: categoryExtensionId } : {}) }, 90_000)
  if (!Array.isArray(response.categories)) throw new Error('쿠팡 등록 확장을 최신 버전으로 업데이트해주세요.')
  return response.categories.filter((item): item is SupplierCategory => !!item && typeof item === 'object'
    && /^\d{1,20}$/.test(String(item.id)) && typeof item.name === 'string' && typeof item.path === 'string'
    && Array.isArray(item.matchedQueries) && item.matchedQueries.every((term: unknown) => typeof term === 'string')).slice(0, 50)
}

export async function getSupplierCategoryTemplate(categoryId: string): Promise<{ name: string; data: string }> {
  if (!/^[1-9]\d{0,19}$/.test(categoryId)) throw new Error('쿠팡 카테고리를 확인해주세요.')
  const response = await request('CATEGORY_TEMPLATE', undefined, { categoryId, ...(categoryExtensionId ? { extensionId: categoryExtensionId } : {}) }, 90_000)
  const file = response.file as { name?: unknown; data?: unknown } | undefined
  if (!file || typeof file.name !== 'string' || !file.name || file.name.length > 250 || /[\\/]/.test(file.name)
    || typeof file.data !== 'string' || file.data.length > 4_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(file.data)) throw new Error('쿠팡 공식 양식 파일을 확인하지 못했습니다.')
  return { name: file.name, data: file.data }
}

export async function startSupplierRegistration(job: SupplierTransferJob): Promise<{ started: true }> {
  pendingJobs.set(job.jobId, job.token)
  await request('START', job, categoryExtensionId ? { extensionId: categoryExtensionId } : {})
  return { started: true }
}

export async function checkSupplierRegistration(job: SupplierTransferJob): Promise<{ started: true }> {
  pendingJobs.set(job.jobId, job.token)
  await request('CHECK', job)
  return { started: true }
}

async function controlSupplierRegistration(type: string, job: SupplierJobReference, productId?: string) {
  pendingJobs.set(job.jobId, job.token)
  await request(type, job, { ...(productId ? { productId } : {}), ...(categoryExtensionId ? { extensionId: categoryExtensionId } : {}) })
}

/** An absent job is not permission to restart it: another Chrome may own it. */
export async function inspectSupplierRegistration(job: SupplierJobReference): Promise<{ found: false } | { found: true; mode: 'excel' | 'individual'; status: string }> {
  const response = await request('INSPECT_JOB', job, categoryExtensionId ? { extensionId: categoryExtensionId } : {})
  if (response.found === false) return { found: false }
  if (response.found === true && (response.mode === 'excel' || response.mode === 'individual') && typeof response.status === 'string') return { found: true, mode: response.mode, status: response.status }
  throw new Error('쿠팡 등록 확장을 최신 버전으로 업데이트하고 작업을 확인해주세요.')
}

export const attachSupplierRegistration = (job: SupplierJobReference) => controlSupplierRegistration('ATTACH_JOB', job)
export const resumeSupplierRegistration = (job: SupplierJobReference) => controlSupplierRegistration('RESUME_JOB', job)
export const stopSupplierRegistration = (job: SupplierJobReference) => controlSupplierRegistration('STOP_JOB', job)
export const openSupplierRegistration = (job: SupplierJobReference, productId?: string) => controlSupplierRegistration('OPEN_JOB', job, productId)

export function subscribeSupplierRegistration(callback: (event: SupplierRegistrationProgress) => void): () => void {
  const receive = (event: MessageEvent) => {
    if (!trustedMessage(event) || event.data.type !== 'PROGRESS') return
    const value = event.data.progress as SupplierRegistrationProgress | undefined
    if (!value || pendingJobs.get(value.jobId) !== value.token || typeof value.message !== 'string') return
    if (!['running', 'login_required', 'attention_required', 'prepared', 'cancelled', 'failed', 'succeeded'].includes(value.status)) return
    callback(value)
  }
  window.addEventListener('message', receive)
  return () => window.removeEventListener('message', receive)
}
import type { IndividualProduct } from './individual'
import type { RegistrationProductProgress } from './model'
