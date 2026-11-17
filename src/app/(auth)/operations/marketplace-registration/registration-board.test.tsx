import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { RegistrationRow } from '@/lib/operations/marketplace-registration'
import { RegistrationBoard } from './registration-board'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/components/product-linking/product-link-panel', () => ({ ProductLinkPanel: () => null }))
vi.mock('./actions', () => ({
  applyRegistrationAction: vi.fn(),
  syncFuntasticB2bAction: vi.fn(),
  syncMarketplaceRegistrationSalesCodesAction: vi.fn(),
}))

it('shows the existing product details together with the marketplace form', () => {
  const row: RegistrationRow = {
    id: '1', productCode: 'SKU-1', salesCodes: ['OPTION-1'], productName: '테스트 상품',
    stock: 3, price: 10000, retailPrice: 10000, costPrice: 5000, minOrderQty: 1,
    unit: 'EA', shippingFee: 0, sourceStatus: 'SELLING', sourceCategoryName: null,
    sourceProductId: null, sourceDescription: null, sourceTags: null, sourceUpdatedAt: null,
    lastSyncedAt: null, commonCategory: '생활용품', brand: '테스트 브랜드',
    manufacturer: '테스트 제조사', countryOfOrigin: '한국',
    sourceProductUrl: 'https://example.com/product',
    primaryImageUrl: 'https://example.com/primary.webp', sourceImageUrl: null,
    thumbnailUrls: [], imageUrls: [],
    detailImageUrls: ['https://example.com/detail.webp'],
    linkedWorkflowId: 'workflow-1', linkedDetailPageUrl: 'https://example.com/detail',
    options: [{ id: 'o1', optionName: '흰색', stockQty: 3, status: 'SELLING', barcode: 'OPTION-1' }],
    productNotice: [{ label: '모델명', value: 'MODEL-1' }], channels: [],
    matchedSalesCodes: 1, matchedSalesCodeList: ['OPTION-1'], inventorySkus: [], inventoryAvailableStock: 0,
  }
  render(<RegistrationBoard rows={[row]} focusedRegistration={<div>몰 상품등록번호 입력</div>} />)
  expect(screen.getByText('몰 상품등록번호 입력')).toBeVisible()
  expect(screen.getByRole('link', { name: 'https://example.com/product' })).toHaveAttribute('href', row.sourceProductUrl)
  expect(screen.getByRole('link', { name: '완성 상세페이지 열기' })).toHaveAttribute('href', row.linkedDetailPageUrl)
  expect(screen.getByRole('link', { name: '원본 이미지 1' })).toHaveAttribute('href', row.detailImageUrls[0])
  expect(screen.getByDisplayValue('https://example.com/primary.webp')).toBeVisible()
  expect(screen.getByText('흰색')).toBeVisible()
  expect(screen.getByText('MODEL-1')).toBeVisible()
  expect(screen.getByRole('button', { name: '등록정보 저장' })).toBeVisible()
})
