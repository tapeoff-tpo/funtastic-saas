import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PurchaseRecommendationGenerator } from './purchase-request-actions'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

describe('budget comparison download button', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    sessionStorage.clear()
  })

  it('explains how to create a comparison if none has been saved', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      json: async () => ({ error: '구매예산을 입력하고 추천 계산을 먼저 실행해주세요.' }),
    } as Response)
    render(<PurchaseRecommendationGenerator initialTargetStockMonths={1.5} />)
    fireEvent.click(screen.getByRole('button', { name: '예산 비교 엑셀' }))
    expect(await screen.findByText('구매예산을 입력하고 추천 계산을 먼저 실행해주세요.')).toBeTruthy()
  })

  it('downloads the comparison with the server-provided Excel filename', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-disposition': "attachment; filename*=UTF-8''%EB%B9%84%EA%B5%90.xlsx" }),
      blob: async () => new Blob(['test']),
    } as Response)
    const createObjectURL = vi.fn(() => 'blob:comparison')
    vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL, revokeObjectURL: vi.fn() }))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('비교.xlsx')
    })
    render(<PurchaseRecommendationGenerator initialTargetStockMonths={1.5} />)
    fireEvent.click(screen.getByRole('button', { name: '예산 비교 엑셀' }))
    await waitFor(() => expect(click).toHaveBeenCalledOnce())
    expect(createObjectURL).toHaveBeenCalledOnce()
    vi.unstubAllGlobals()
  })
})
