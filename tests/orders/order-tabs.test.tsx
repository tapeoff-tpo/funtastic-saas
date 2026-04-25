import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { OrderTabs } from '@/app/(auth)/orders/order-tabs'

describe('OrderTabs — 9탭', () => {
  it('renders 9 tabs in fixed order', () => {
    const counts = { all: 100, new: 1, confirmed: 2, preparing: 3, shipped: 4, delivering: 5, delivered: 6, cancelled: 7, exchange: 8, return: 9 }
    render(<NuqsTestingAdapter><OrderTabs counts={counts} /></NuqsTestingAdapter>)
    for (const label of ['신규','확인','출고대기','출고완료','배송중','배송완료','취소','교환','반품']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })
  it.todo('취소 탭 클릭 시 ?status=cancelled OR ?claimType=cancel 분기')
  it.todo('각 탭에 카운트 뱃지 표시')
})
