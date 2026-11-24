export type SupplierRegistrationFile = { name: string; data: string; kind: 'workbook' | 'label' }
export type SupplierCategory = { id: string; name: string; path: string; matchedQueries: string[] }
export type SupplierRegistrationJob = {
  jobId: string
  token: string
  files: SupplierRegistrationFile[]
  rows: { id: string; name: string }[]
}
export type SupplierRegistrationProgress = {
  jobId: string
  token: string
  status: 'running' | 'login_required' | 'failed' | 'succeeded'
  message: string
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

function request(type: string, job?: SupplierRegistrationJob, payload: Record<string, unknown> = {}, timeout = 5000): Promise<Record<string, unknown>> {
  if (typeof window === 'undefined') return Promise.reject(new Error('Chrome에서 쿠팡 등록 화면을 열어주세요.'))
  const requestId = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener('message', receive)
      reject(new Error('쿠팡 등록 확장에 연결하지 못했습니다. 확장을 설치하거나 새로고침해주세요.'))
    }, timeout)
    const receive = (event: MessageEvent) => {
      if (!trustedMessage(event) || event.data.type !== 'RESPONSE' || event.data.requestId !== requestId) return
      window.clearTimeout(timer)
      window.removeEventListener('message', receive)
      if (event.data.ok === false) reject(new Error(String(event.data.error || '서플라이어허브 작업을 시작하지 못했습니다.')))
      else resolve(event.data)
    }
    window.addEventListener('message', receive)
    window.postMessage({ source: PAGE_SOURCE, type, requestId, ...payload, ...(job ? { job } : {}) }, window.location.origin)
  })
}

export async function pingSupplierExtension(): Promise<{ connected: boolean; version?: string; supportsCategories?: boolean }> {
  try {
    const response = await request('PING')
    return { connected: true, version: typeof response.version === 'string' ? response.version : undefined, ...(response.supportsCategories === true ? { supportsCategories: true } : {}) }
  } catch { return { connected: false } }
}

export async function searchSupplierCategories(queries: string[]): Promise<SupplierCategory[]> {
  const terms = [...new Set(queries.map((value) => value.trim()).filter(Boolean))].slice(0, 6)
  if (!terms.length || terms.some((value) => value.length > 200)) throw new Error('카테고리 검색어를 확인해주세요.')
  const response = await request('CATEGORY_SEARCH', undefined, { queries: terms }, 90_000)
  if (!Array.isArray(response.categories)) throw new Error('쿠팡 등록 확장을 최신 버전으로 업데이트해주세요.')
  return response.categories.filter((item): item is SupplierCategory => !!item && typeof item === 'object'
    && /^\d{1,20}$/.test(String(item.id)) && typeof item.name === 'string' && typeof item.path === 'string'
    && Array.isArray(item.matchedQueries) && item.matchedQueries.every((term: unknown) => typeof term === 'string')).slice(0, 50)
}

export async function getSupplierCategoryTemplate(categoryId: string): Promise<{ name: string; data: string }> {
  if (!/^[1-9]\d{0,19}$/.test(categoryId)) throw new Error('쿠팡 카테고리를 확인해주세요.')
  const response = await request('CATEGORY_TEMPLATE', undefined, { categoryId }, 90_000)
  const file = response.file as { name?: unknown; data?: unknown } | undefined
  if (!file || typeof file.name !== 'string' || !file.name || file.name.length > 250 || /[\\/]/.test(file.name)
    || typeof file.data !== 'string' || file.data.length > 4_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(file.data)) throw new Error('쿠팡 공식 양식 파일을 확인하지 못했습니다.')
  return { name: file.name, data: file.data }
}

export async function startSupplierRegistration(job: SupplierRegistrationJob): Promise<{ started: true }> {
  pendingJobs.set(job.jobId, job.token)
  await request('START', job)
  return { started: true }
}

export async function checkSupplierRegistration(job: SupplierRegistrationJob): Promise<{ started: true }> {
  pendingJobs.set(job.jobId, job.token)
  await request('CHECK', job)
  return { started: true }
}

export function subscribeSupplierRegistration(callback: (event: SupplierRegistrationProgress) => void): () => void {
  const receive = (event: MessageEvent) => {
    if (!trustedMessage(event) || event.data.type !== 'PROGRESS') return
    const value = event.data.progress as SupplierRegistrationProgress | undefined
    if (!value || pendingJobs.get(value.jobId) !== value.token || typeof value.message !== 'string') return
    if (!['running', 'login_required', 'failed', 'succeeded'].includes(value.status)) return
    callback(value)
  }
  window.addEventListener('message', receive)
  return () => window.removeEventListener('message', receive)
}
