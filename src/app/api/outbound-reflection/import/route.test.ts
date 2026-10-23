import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class InvalidExcelWorkbookError extends Error {}
  class ExcelWorkbookPasswordRequiredError extends InvalidExcelWorkbookError {
    constructor() {
      super('파일이 비밀번호로 보호되어 있습니다. 파일의 비밀번호를 입력하여 주세요.')
    }
  }
  class ExcelWorkbookPasswordInvalidError extends InvalidExcelWorkbookError {
    constructor() {
      super('파일 비밀번호가 올바르지 않습니다. 다시 입력하여 주세요.')
    }
  }

  class WorkspaceDataOperationInProgressError extends Error {
    constructor() {
      super('다른 엑셀 데이터 반영 작업이 진행 중입니다. 현재 작업이 끝난 뒤 다시 실행해주세요.')
    }
  }

  return {
    importOutboundReflectionBatch: vi.fn(),
    revalidatePath: vi.fn(),
    withWorkspaceDataOperationLock: vi.fn(async (_userId: string, operation: () => Promise<unknown>) => operation()),
    InvalidExcelWorkbookError,
    ExcelWorkbookPasswordRequiredError,
    ExcelWorkbookPasswordInvalidError,
    WorkspaceDataOperationInProgressError,
  }
})

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'auth-user' } },
        error: null,
      }),
    },
  }),
}))

vi.mock('@/lib/admin-accounts/queries', () => ({
  getWorkspaceUserId: vi.fn().mockResolvedValue('workspace-user'),
}))

vi.mock('@/lib/data-operation-lock', () => ({
  withWorkspaceDataOperationLock: mocks.withWorkspaceDataOperationLock,
  WorkspaceDataOperationInProgressError: mocks.WorkspaceDataOperationInProgressError,
}))

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/db/schema', () => ({ excelImportTemplates: {} }))
vi.mock('drizzle-orm', () => ({
  and: vi.fn(),
  eq: vi.fn(),
}))
vi.mock('@/lib/orders/default-import-templates', () => ({
  DEFAULT_ORDER_IMPORT_TEMPLATES: [{
    id: 'default:sabangnet-sales-confirmation',
    mappings: [],
  }],
}))
vi.mock('@/lib/orders/excel-workbook-buffer', () => ({
  InvalidExcelWorkbookError: mocks.InvalidExcelWorkbookError,
  ExcelWorkbookPasswordRequiredError: mocks.ExcelWorkbookPasswordRequiredError,
  ExcelWorkbookPasswordInvalidError: mocks.ExcelWorkbookPasswordInvalidError,
}))
vi.mock('@/lib/outbound-reflection', () => ({
  importOutboundReflectionBatch: mocks.importOutboundReflectionBatch,
}))

function importRequest(values: Record<string, unknown> = {}) {
  const file = {
    name: 'outbound.xlsx',
    arrayBuffer: async () => new ArrayBuffer(0),
  }
  return {
    formData: async () => ({
      get: (key: string) => key === 'file' ? file : values[key] ?? null,
    }),
  }
}

describe('POST /api/outbound-reflection/import', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.withWorkspaceDataOperationLock.mockImplementation(
      async (_userId: string, operation: () => Promise<unknown>) => operation(),
    )
  })

  it('returns the parser error as a 400 instead of registering an empty batch', async () => {
    mocks.importOutboundReflectionBatch.mockResolvedValue({
      batchId: null,
      skipped: false,
      totalRows: 0,
      readyRows: 0,
      blockedRows: 0,
      errors: [{ row: 1, message: '필수 컬럼 누락: 사방넷 주문번호' }],
    })
    const { POST } = await import('./route')

    const response = await POST(importRequest() as never)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: '출고반영 파일에서 등록할 행을 찾지 못했습니다. 1행: 필수 컬럼 누락: 사방넷 주문번호',
      errors: [{ row: 1, message: '필수 컬럼 누락: 사방넷 주문번호' }],
    })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it('keeps an existing duplicate batch as a successful skipped response', async () => {
    const duplicate = {
      batchId: 'existing-batch',
      skipped: true,
      totalRows: 0,
      readyRows: 0,
      blockedRows: 0,
      errors: [],
    }
    mocks.importOutboundReflectionBatch.mockResolvedValue(duplicate)
    const { POST } = await import('./route')

    const response = await POST(importRequest() as never)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(duplicate)
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/outbound-reflection')
  })

  it('does not treat a skipped flag without an existing batch as a duplicate', async () => {
    mocks.importOutboundReflectionBatch.mockResolvedValue({
      batchId: null,
      skipped: true,
      totalRows: 0,
      readyRows: 0,
      blockedRows: 0,
      errors: [{ row: 2, message: '필수 컬럼 누락: 출고완료일자' }],
    })
    const { POST } = await import('./route')

    const response = await POST(importRequest() as never)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: '출고반영 파일에서 등록할 행을 찾지 못했습니다. 2행: 필수 컬럼 누락: 출고완료일자',
      errors: [{ row: 2, message: '필수 컬럼 누락: 출고완료일자' }],
    })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it('uses the supplied file password for only the current import request', async () => {
    mocks.importOutboundReflectionBatch.mockResolvedValue({
      batchId: 'new-batch',
      skipped: false,
      totalRows: 1,
      readyRows: 1,
      blockedRows: 0,
      errors: [],
    })
    const { POST } = await import('./route')

    const response = await POST(importRequest({ filePassword: 'temporary-file-password' }) as never)

    expect(response.status).toBe(200)
    expect(mocks.importOutboundReflectionBatch).toHaveBeenCalledWith(expect.objectContaining({
      filePassword: 'temporary-file-password',
    }))
  })

  it('returns a structured password-required response without logging the error', async () => {
    mocks.importOutboundReflectionBatch.mockRejectedValue(new mocks.ExcelWorkbookPasswordRequiredError())
    const { POST } = await import('./route')

    const response = await POST(importRequest() as never)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      code: 'excel_password_required',
      error: '파일이 비밀번호로 보호되어 있습니다. 파일의 비밀번호를 입력하여 주세요.',
    })
  })

  it('returns a conflict while another bulk data operation is running', async () => {
    mocks.withWorkspaceDataOperationLock.mockRejectedValue(
      new mocks.WorkspaceDataOperationInProgressError(),
    )
    const { POST } = await import('./route')

    const response = await POST(importRequest() as never)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: '다른 엑셀 데이터 반영 작업이 진행 중입니다. 현재 작업이 끝난 뒤 다시 실행해주세요.',
    })
    expect(mocks.importOutboundReflectionBatch).not.toHaveBeenCalled()
  })
})
