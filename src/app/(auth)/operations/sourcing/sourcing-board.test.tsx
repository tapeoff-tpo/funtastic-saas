import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type {
  ManualSourcingItem,
  ManualSourcingReviewStatus,
  SourcingMeeting,
  SourcingOperator,
  SourcingViewer,
} from '@/lib/operations/sourcing'
import type { CnyKrwReferenceRate } from '@/lib/new-products/cny-cost'
import { SourcingBoard } from './sourcing-board'

const navigation = vi.hoisted(() => ({
  search: '',
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/operations/sourcing',
  useRouter: () => navigation,
  useSearchParams: () => new URLSearchParams(navigation.search),
}))

vi.mock('./actions', () => ({
  createSourcingMeetingAction: vi.fn(),
  deleteManualSourcingItemAction: vi.fn(),
  deleteSourcingMeetingAction: vi.fn(),
  saveSourcingOperatorsAction: vi.fn(),
  saveSourcingMeetingRowsAction: vi.fn(),
  updateSourcingMeetingAction: vi.fn(),
}))

const operator: SourcingOperator = {
  id: 'operator-1',
  memberUserId: 'member-1',
  displayName: '소싱 담당자',
  position: 0,
  isActive: true,
}
const viewer: SourcingViewer = { isMain: true, operatorId: null }
const exchangeRate: CnyKrwReferenceRate = { rate: 200, date: '2026-11-11', source: 'latest' }
const linkedProductId = 'existing-product-1'

function sourcingItem(overrides: Partial<ManualSourcingItem> = {}): ManualSourcingItem {
  return {
    id: 'older-sourcing-item',
    meetingId: 'older-meeting',
    ownerOperatorId: operator.id,
    ownerName: operator.displayName,
    productName: '이전 회의 상품',
    productOption: '기존 옵션',
    options: [],
    chinaPurchaseUrl: null,
    chinaUnitPriceCny: 10,
    unitShippingCny: 1,
    shippingChargeType: 'unit',
    shippingBundleQuantity: null,
    exchangeRateKrw: 200,
    calculatedCostKrw: 2200,
    domesticSaleUrl: null,
    domesticSalePrice: null,
    detailPageUrl: null,
    memo1: null,
    memo2: null,
    status: 'passed',
    hasImageFile: false,
    legacyImageUrl: null,
    passedNewProductId: linkedProductId,
    createdAt: '2026-11-04T05:00:00Z',
    updatedAt: '2026-11-04T06:00:00Z',
    ...overrides,
  }
}

function olderMeeting(items: ManualSourcingItem[]): SourcingMeeting {
  return {
    id: 'older-meeting',
    meetingDate: '2026-11-04',
    title: '2026년 11월 4일 소싱회의',
    status: 'closed',
    createdByUserId: 'member-1',
    createdAt: '2026-11-04T04:00:00Z',
    updatedAt: '2026-11-04T06:00:00Z',
    items,
  }
}

function renderBoard(meetings: SourcingMeeting[]) {
  return render(
    <SourcingBoard
      meetings={meetings}
      operators={[operator]}
      viewer={viewer}
      exchangeRate={exchangeRate}
      availableMembers={[]}
    />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  navigation.search = 'meeting=older-meeting'
})

afterEach(cleanup)

describe('SourcingBoard existing meeting review links', () => {
  it('opens a populated older meeting and links a passed item to its registered product', () => {
    renderBoard([olderMeeting([sourcingItem()])])

    expect(screen.getByRole('heading', { name: '2026년 11월 4일 소싱회의' })).toBeInTheDocument()
    expect(screen.getByText('이전 회의 상품')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '샘플·정식발주 열기' })).toHaveAttribute(
      'href',
      `/new-products?item=${linkedProductId}`,
    )
  })

  it('renders a passed item without a registered product without a product link', () => {
    renderBoard([olderMeeting([sourcingItem({ passedNewProductId: null })])])

    expect(screen.getByText('통과')).toBeInTheDocument()
    expect(screen.getByText('이전 회의 상품')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '샘플·정식발주 열기' })).not.toBeInTheDocument()
  })

  it.each([
    { status: 'pending', label: '진행 전' },
    { status: 'hold', label: '보류' },
    { status: 'rejected', label: '탈락' },
  ] satisfies Array<{ status: ManualSourcingReviewStatus; label: string }>)(
    'renders a $status item without a product link even if a product ID remains',
    ({ status, label }) => {
      renderBoard([olderMeeting([sourcingItem({ status })])])

      expect(screen.getByText(label)).toBeInTheDocument()
      expect(screen.getByText('이전 회의 상품')).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: '샘플·정식발주 열기' })).not.toBeInTheDocument()
    },
  )

  it('shows a passed older item and its product link in all-meeting search results', () => {
    navigation.search = ''
    renderBoard([olderMeeting([sourcingItem()])])

    fireEvent.change(screen.getByPlaceholderText('상품명 · 옵션 · URL · 비고 검색'), {
      target: { value: '이전 회의 상품' },
    })

    expect(screen.getByRole('heading', { name: '상품 검색 결과' })).toBeInTheDocument()
    expect(screen.getByText('이전 회의 상품')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '샘플·정식발주 열기' })).toHaveAttribute(
      'href',
      `/new-products?item=${linkedProductId}`,
    )
  })
})
