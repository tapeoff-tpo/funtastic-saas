/**
 * MSW request handlers for marketplace API mocking.
 *
 * Provides mock responses for Coupang and Naver API endpoints
 * used in adapter tests.
 */

import { http, HttpResponse } from 'msw'

// ============================================================================
// Coupang Mock Data
// ============================================================================

export const MOCK_COUPANG_ORDER_SHEETS = [
  {
    orderId: 1001,
    orderSheetId: 2001,
    vendorItemId: 3001,
    vendorItemName: '테스트 상품 A',
    shippingCount: 2,
    orderer: { name: '김구매', email: 'buyer@test.com' },
    receiver: {
      name: '이수령',
      phone: '010-1234-5678',
      addr1: '서울특별시 강남구 테헤란로 123',
      addr2: '4층 401호',
      postCode: '06134',
      zipCode: '06134',
    },
    paidAt: '2026-04-02T10:00:00Z',
    status: 'ACCEPT',
    paymentPrice: 29800,
    orderPrice: 14900,
    sellerProductId: 5001,
    shippingPrice: 0,
    overseaShippingPrice: 0,
    vendorItemPackageId: 7001,
    vendorItemPackageName: '패키지 A',
  },
  {
    orderId: 1002,
    orderSheetId: 2002,
    vendorItemId: 3002,
    vendorItemName: '테스트 상품 B',
    shippingCount: 1,
    orderer: { name: '박주문', email: 'buyer2@test.com' },
    receiver: {
      name: '최배송',
      phone: '010-9876-5432',
      addr1: '부산광역시 해운대구 우동 123',
      addr2: '',
      postCode: '48060',
      zipCode: '48060',
    },
    paidAt: '2026-04-02T11:00:00Z',
    status: 'DELIVERING',
    paymentPrice: 15000,
    orderPrice: 15000,
    sellerProductId: 5002,
    shippingPrice: 3000,
    overseaShippingPrice: 0,
    vendorItemPackageId: 7002,
    vendorItemPackageName: '패키지 B',
  },
]

export const MOCK_COUPANG_RETURN_REQUESTS = [
  {
    returnId: 9001,
    orderId: 1001,
    returnStatus: 'RECEIPT',
    returnReason: '상품 불량',
    createdAt: '2026-04-02T14:00:00Z',
    vendorItemId: 3001,
    vendorItemName: '테스트 상품 A',
  },
]

// ============================================================================
// Naver Mock Data
// ============================================================================

export const MOCK_NAVER_TOKEN_RESPONSE = {
  access_token: 'mock-naver-access-token-12345',
  expires_in: 21600,
  token_type: 'Bearer',
}

export const MOCK_NAVER_LAST_CHANGED_STATUSES = {
  data: {
    lastChangeStatuses: [
      {
        productOrderId: 'PO-2026040201001',
        lastChangedType: 'PAYED',
        lastChangedDate: '2026-04-02T10:00:00.000+09:00',
      },
      {
        productOrderId: 'PO-2026040201002',
        lastChangedType: 'DELIVERING',
        lastChangedDate: '2026-04-02T11:00:00.000+09:00',
      },
    ],
  },
}

export const MOCK_NAVER_PRODUCT_ORDERS = {
  data: [
    {
      productOrderId: 'PO-2026040201001',
      orderId: 'NO-2026040201001',
      productOrderStatus: 'PAYED',
      quantity: 3,
      unitPrice: 12000,
      productName: '네이버 테스트 상품 1',
      optionInfo: '색상: 빨강 / 사이즈: L',
      ordererName: '김네이버',
      ordererTel: '010-1111-2222',
      shippingAddress: {
        zipCode: '03088',
        baseAddress: '서울특별시 종로구 율곡로 10',
        detailedAddress: '2동 301호',
      },
      paymentDate: '2026-04-02T10:00:00.000+09:00',
      totalPaymentAmount: 36000,
    },
    {
      productOrderId: 'PO-2026040201002',
      orderId: 'NO-2026040201002',
      productOrderStatus: 'DELIVERING',
      quantity: 1,
      unitPrice: 25000,
      productName: '네이버 테스트 상품 2',
      optionInfo: '',
      ordererName: '이스마트',
      ordererTel: '010-3333-4444',
      shippingAddress: {
        zipCode: '12345',
        baseAddress: '경기도 성남시 분당구 정자동 100',
        detailedAddress: '',
      },
      paymentDate: '2026-04-02T11:00:00.000+09:00',
      totalPaymentAmount: 25000,
    },
  ],
}

export const MOCK_NAVER_CLAIM_CHANGED_STATUSES = {
  data: {
    lastChangeStatuses: [
      {
        productOrderId: 'PO-2026040201003',
        lastChangedType: 'CANCEL',
        lastChangedDate: '2026-04-02T15:00:00.000+09:00',
      },
    ],
  },
}

export const MOCK_NAVER_CLAIM_PRODUCT_ORDERS = {
  data: [
    {
      productOrderId: 'PO-2026040201003',
      orderId: 'NO-2026040201003',
      productOrderStatus: 'CANCELED',
      quantity: 1,
      unitPrice: 9900,
      productName: '네이버 취소 상품',
      optionInfo: '',
      ordererName: '박취소',
      ordererTel: '010-5555-6666',
      shippingAddress: {
        zipCode: '54321',
        baseAddress: '대전광역시 서구 둔산동 200',
        detailedAddress: '',
      },
      paymentDate: '2026-04-02T09:00:00.000+09:00',
      totalPaymentAmount: 9900,
      claimType: 'CANCEL',
      claimStatus: 'CANCEL_DONE',
      claimReason: '단순변심',
    },
  ],
}

// ============================================================================
// Coupang Handlers
// ============================================================================

const coupangHandlers = [
  http.get('https://api-gateway.coupang.com/v2/providers/openapi/apis/api/v5/vendors/:vendorId/ordersheets', () => {
    return HttpResponse.json({
      code: '200',
      message: 'OK',
      data: MOCK_COUPANG_ORDER_SHEETS,
    })
  }),

  http.get('https://api-gateway.coupang.com/v2/providers/openapi/apis/api/v4/vendors/:vendorId/returnRequests', () => {
    return HttpResponse.json({
      code: '200',
      message: 'OK',
      data: MOCK_COUPANG_RETURN_REQUESTS,
    })
  }),
]

// ============================================================================
// Naver Handlers
// ============================================================================

const naverHandlers = [
  http.post('https://api.commerce.naver.com/external/v1/oauth2/token', () => {
    return HttpResponse.json(MOCK_NAVER_TOKEN_RESPONSE)
  }),

  http.get('https://api.commerce.naver.com/v1/pay-order/seller/product-orders/last-changed-statuses', ({ request }) => {
    const url = new URL(request.url)
    const lastChangedType = url.searchParams.get('lastChangedType') || ''

    // Return claim statuses if claim types are requested
    if (lastChangedType.includes('CANCEL') || lastChangedType.includes('RETURN') || lastChangedType.includes('EXCHANGE')) {
      return HttpResponse.json(MOCK_NAVER_CLAIM_CHANGED_STATUSES)
    }

    return HttpResponse.json(MOCK_NAVER_LAST_CHANGED_STATUSES)
  }),

  http.post('https://api.commerce.naver.com/v1/pay-order/seller/product-orders/query', async ({ request }) => {
    const body = await request.json() as { productOrderIds?: string[] }
    const ids = body?.productOrderIds || []

    // Check if any of the requested IDs are claim orders
    if (ids.includes('PO-2026040201003')) {
      return HttpResponse.json(MOCK_NAVER_CLAIM_PRODUCT_ORDERS)
    }

    return HttpResponse.json(MOCK_NAVER_PRODUCT_ORDERS)
  }),
]

// ============================================================================
// Export all handlers
// ============================================================================

export const handlers = [...coupangHandlers, ...naverHandlers]
export { coupangHandlers, naverHandlers }
