import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { NuqsTestingAdapter, type UrlUpdateEvent } from 'nuqs/adapters/testing'
import { OrderTabs } from '@/app/(auth)/orders/order-tabs'

const SAMPLE_COUNTS = {
  all: 100,
  new: 1,
  confirmed: 2,
  preparing: 3,
  shipped: 4,
  delivering: 5,
  delivered: 6,
  cancelled: 7,
  exchange: 8,
  return: 9,
}

describe('OrderTabs — 9탭 (Phase 8)', () => {
  it('renders 9 status/claim labels in fixed order', () => {
    render(
      <NuqsTestingAdapter>
        <OrderTabs counts={SAMPLE_COUNTS} />
      </NuqsTestingAdapter>,
    )
    for (const label of ['신규', '확인', '출고대기', '출고완료', '배송중', '배송완료', '취소', '교환', '반품']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it('각 탭에 카운트 뱃지가 노출된다', () => {
    render(
      <NuqsTestingAdapter>
        <OrderTabs counts={SAMPLE_COUNTS} />
      </NuqsTestingAdapter>,
    )
    // 카운트 값들이 ko-KR 포맷으로 렌더된다 (작은 숫자라 separator 없음)
    expect(screen.getByText('100')).toBeInTheDocument() // 전체
    expect(screen.getByText('7')).toBeInTheDocument() // 취소
    expect(screen.getByText('8')).toBeInTheDocument() // 교환
    expect(screen.getByText('9')).toBeInTheDocument() // 반품
  })

  it('취소 탭 클릭 시 ?cancel=true URL 업데이트', async () => {
    const events: UrlUpdateEvent[] = []
    render(
      <NuqsTestingAdapter onUrlUpdate={(e) => events.push(e)}>
        <OrderTabs counts={SAMPLE_COUNTS} />
      </NuqsTestingAdapter>,
    )
    fireEvent.click(screen.getByText('취소'))
    // useQueryState writes happen as Promise.all; wait for microtask flush
    await waitFor(() => {
      const sawCancel = events.some((e) => e.queryString.includes('cancel=true'))
      expect(sawCancel).toBe(true)
    })
  })

  it('교환 탭 클릭 시 ?claimType=exchange URL 업데이트', async () => {
    const events: UrlUpdateEvent[] = []
    render(
      <NuqsTestingAdapter onUrlUpdate={(e) => events.push(e)}>
        <OrderTabs counts={SAMPLE_COUNTS} />
      </NuqsTestingAdapter>,
    )
    fireEvent.click(screen.getByText('교환'))
    await waitFor(() => {
      const sawClaim = events.some((e) => e.queryString.includes('claimType=exchange'))
      expect(sawClaim).toBe(true)
    })
  })
})
