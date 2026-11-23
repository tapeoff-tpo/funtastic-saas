export type SupplierRegistrationFile = { name: string; data: string; kind: 'workbook' | 'label' }
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

function request(type: string, job?: SupplierRegistrationJob): Promise<Record<string, unknown>> {
  if (typeof window === 'undefined') return Promise.reject(new Error('Chrome에서 쿠팡 등록 화면을 열어주세요.'))
  const requestId = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener('message', receive)
      reject(new Error('쿠팡 등록 확장에 연결하지 못했습니다. 확장을 설치하거나 새로고침해주세요.'))
    }, 5000)
    const receive = (event: MessageEvent) => {
      if (!trustedMessage(event) || event.data.type !== 'RESPONSE' || event.data.requestId !== requestId) return
      window.clearTimeout(timer)
      window.removeEventListener('message', receive)
      if (event.data.ok === false) reject(new Error(String(event.data.error || '서플라이어허브 작업을 시작하지 못했습니다.')))
      else resolve(event.data)
    }
    window.addEventListener('message', receive)
    window.postMessage({ source: PAGE_SOURCE, type, requestId, ...(job ? { job } : {}) }, window.location.origin)
  })
}

export async function pingSupplierExtension(): Promise<{ connected: boolean; version?: string }> {
  try {
    const response = await request('PING')
    return { connected: true, version: typeof response.version === 'string' ? response.version : undefined }
  } catch { return { connected: false } }
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
