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
    shipmentBoxId: 4001,
    orderId: 1001,
    orderedAt: '2026-04-02T09:55:00Z',
    orderer: {
      name: '김구매',
      email: 'buyer@test.com',
      safeNumber: '0504-1111-2222',
      ordererNumber: null,
    },
    receiver: {
      name: '이수령',
      safeNumber: '010-1234-5678',
      receiverNumber: null,
      addr1: '서울특별시 강남구 테헤란로 123',
      addr2: '4층 401호',
      postCode: '06134',
    },
    paidAt: '2026-04-02T10:00:00Z',
    status: 'ACCEPT',
    shippingPrice: { currencyCode: 'KRW', units: 0, nanos: 0 },
    remotePrice: { currencyCode: 'KRW', units: 0, nanos: 0 },
    remoteArea: false,
    parcelPrintMessage: '',
    splitShipping: false,
    ableSplitShipping: false,
    orderItems: [
      {
        vendorItemPackageId: 7001,
        vendorItemPackageName: '패키지 A',
        productId: 5001,
        vendorItemId: 3001,
        vendorItemName: '테스트 상품 A',
        shippingCount: 2,
        salesPrice: { currencyCode: 'KRW', units: 14900, nanos: 0 },
        orderPrice: { currencyCode: 'KRW', units: 14900, nanos: 0 },
        discountPrice: { currencyCode: 'KRW', units: 0, nanos: 0 },
        instantCouponDiscount: { currencyCode: 'KRW', units: 0, nanos: 0 },
        downloadableCouponDiscount: { currencyCode: 'KRW', units: 0, nanos: 0 },
        coupangDiscount: { currencyCode: 'KRW', units: 0, nanos: 0 },
        externalVendorSkuCode: 'SKU-CP001',
        sellerProductId: 5001,
        sellerProductName: '테스트 상품 A',
        sellerProductItemName: '',
        firstSellerProductItemName: '',
        cancelCount: 0,
        holdCountForCancel: 0,
        estimatedShippingDate: '2026-04-03',
        canceled: false,
        confirmDate: null,
        deliveryChargeTypeName: '무료배송',
        pricingBadge: false,
        usedProduct: false,
      },
    ],
    deliveryCompanyName: '',
    invoiceNumber: '',
    inTrasitDateTime: null,
    deliveredDate: null,
    refer: '',
    shipmentType: 'NORMAL',
    isCod: false,
  },
  {
    shipmentBoxId: 4002,
    orderId: 1002,
    orderedAt: '2026-04-02T10:55:00Z',
    orderer: {
      name: '박주문',
      email: 'buyer2@test.com',
      safeNumber: '0504-3333-4444',
      ordererNumber: null,
    },
    receiver: {
      name: '최배송',
      safeNumber: '010-9876-5432',
      receiverNumber: null,
      addr1: '부산광역시 해운대구 우동 123',
      addr2: '',
      postCode: '48060',
    },
    paidAt: '2026-04-02T11:00:00Z',
    status: 'DELIVERING',
    shippingPrice: { currencyCode: 'KRW', units: 3000, nanos: 0 },
    remotePrice: { currencyCode: 'KRW', units: 0, nanos: 0 },
    remoteArea: false,
    parcelPrintMessage: '',
    splitShipping: false,
    ableSplitShipping: false,
    orderItems: [
      {
        vendorItemPackageId: 7002,
        vendorItemPackageName: '패키지 B',
        productId: 5002,
        vendorItemId: 3002,
        vendorItemName: '테스트 상품 B',
        shippingCount: 1,
        salesPrice: { currencyCode: 'KRW', units: 15000, nanos: 0 },
        orderPrice: { currencyCode: 'KRW', units: 15000, nanos: 0 },
        discountPrice: { currencyCode: 'KRW', units: 0, nanos: 0 },
        instantCouponDiscount: { currencyCode: 'KRW', units: 0, nanos: 0 },
        downloadableCouponDiscount: { currencyCode: 'KRW', units: 0, nanos: 0 },
        coupangDiscount: { currencyCode: 'KRW', units: 0, nanos: 0 },
        externalVendorSkuCode: 'SKU-CP002',
        sellerProductId: 5002,
        sellerProductName: '테스트 상품 B',
        sellerProductItemName: '',
        firstSellerProductItemName: '',
        cancelCount: 0,
        holdCountForCancel: 0,
        estimatedShippingDate: '2026-04-03',
        canceled: false,
        confirmDate: null,
        deliveryChargeTypeName: '선불',
        pricingBadge: false,
        usedProduct: false,
      },
    ],
    deliveryCompanyName: '',
    invoiceNumber: '',
    inTrasitDateTime: null,
    deliveredDate: null,
    refer: '',
    shipmentType: 'NORMAL',
    isCod: false,
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
      order: {
        orderId: 'NO-2026040201001',
        orderDate: '2026-04-02T09:59:00.000+09:00',
        ordererName: '김네이버',
        ordererTel: '010-1111-2222',
        paymentDate: '2026-04-02T10:00:00.000+09:00',
      },
      productOrder: {
        productOrderId: 'PO-2026040201001',
        productOrderStatus: 'PAYED',
        quantity: 3,
        unitPrice: 12000,
        productName: '네이버 테스트 상품 1',
        productOption: '색상: 빨강 / 사이즈: L',
        shippingAddress: {
          name: '김네이버',
          tel1: '010-1111-2222',
          zipCode: '03088',
          baseAddress: '서울특별시 종로구 율곡로 10',
          detailedAddress: '2동 301호',
        },
        totalPaymentAmount: 36000,
      },
    },
    {
      order: {
        orderId: 'NO-2026040201002',
        orderDate: '2026-04-02T10:59:00.000+09:00',
        ordererName: '이스마트',
        ordererTel: '010-3333-4444',
        paymentDate: '2026-04-02T11:00:00.000+09:00',
      },
      productOrder: {
        productOrderId: 'PO-2026040201002',
        productOrderStatus: 'DELIVERING',
        quantity: 1,
        unitPrice: 25000,
        productName: '네이버 테스트 상품 2',
        productOption: '',
        shippingAddress: {
          name: '이스마트',
          tel1: '010-3333-4444',
          zipCode: '12345',
          baseAddress: '경기도 성남시 분당구 정자동 100',
          detailedAddress: '',
        },
        totalPaymentAmount: 25000,
      },
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
      order: {
        orderId: 'NO-2026040201003',
        orderDate: '2026-04-02T08:59:00.000+09:00',
        ordererName: '박취소',
        ordererTel: '010-5555-6666',
        paymentDate: '2026-04-02T09:00:00.000+09:00',
      },
      productOrder: {
        productOrderId: 'PO-2026040201003',
        productOrderStatus: 'CANCELED',
        quantity: 1,
        unitPrice: 9900,
        productName: '네이버 취소 상품',
        productOption: '',
        shippingAddress: {
          name: '박취소',
          tel1: '010-5555-6666',
          zipCode: '54321',
          baseAddress: '대전광역시 서구 둔산동 200',
          detailedAddress: '',
        },
        totalPaymentAmount: 9900,
        claimType: 'CANCEL',
        claimStatus: 'CANCEL_DONE',
        claimReason: '단순변심',
      },
    },
  ],
}

// ============================================================================
// ESM Mock Data (Gmarket + Auction)
// ============================================================================

export const MOCK_ESM_ORDERS = [
  {
    orderNo: 'ESM-G-20260402-001',
    siteType: 'G' as const,
    orderItemSeq: 'ITEM-001',
    itemName: '지마켓 테스트 상품 1',
    orderQty: 2,
    buyerName: '김지마켓',
    buyerPhone: '010-1234-5678',
    receiverName: '이배송',
    receiverPhone: '010-8765-4321',
    receiverZipcode: '06134',
    receiverAddress: '서울특별시 강남구 테헤란로 456',
    receiverAddressDetail: '7층 701호',
    orderDate: '2026-04-02T10:00:00Z',
    orderStatus: 'PAYMENT_COMPLETE',
    sellPrice: 15000,
    payAmount: 30000,
    sellerItemCode: 'SKU-G001',
    optionInfo: '색상: 블루 / 사이즈: M',
  },
  {
    orderNo: 'ESM-A-20260402-002',
    siteType: 'A' as const,
    orderItemSeq: 'ITEM-002',
    itemName: '옥션 테스트 상품 2',
    orderQty: 1,
    buyerName: '박옥션',
    buyerPhone: '010-9999-8888',
    receiverName: '최수령',
    receiverPhone: '010-7777-6666',
    receiverZipcode: '48060',
    receiverAddress: '부산광역시 해운대구 우동 789',
    receiverAddressDetail: '',
    orderDate: '2026-04-02T11:00:00Z',
    orderStatus: 'DELIVERING',
    sellPrice: 25000,
    payAmount: 25000,
    sellerItemCode: 'SKU-A001',
    optionInfo: '',
  },
]

export const MOCK_ESM_CLAIMS = [
  {
    claimNo: 'CLM-ESM-001',
    orderNo: 'ESM-G-20260402-001',
    siteType: 'G' as const,
    claimType: 'RETURN',
    claimStatus: 'CLAIM_REQUESTED',
    claimReason: '상품 하자',
    claimDate: '2026-04-02T15:00:00Z',
  },
]

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

  http.get('https://api.commerce.naver.com/external/v1/pay-order/seller/product-orders/last-changed-statuses', ({ request }) => {
    const url = new URL(request.url)
    const lastChangedTypes = url.searchParams.getAll('lastChangedType')

    // Return claim statuses if claim types are requested
    if (lastChangedTypes.some((type) => type.includes('CLAIM') || type.includes('COLLECT') || type.includes('CANCEL') || type.includes('RETURN') || type.includes('EXCHANGE'))) {
      return HttpResponse.json(MOCK_NAVER_CLAIM_CHANGED_STATUSES)
    }

    return HttpResponse.json(MOCK_NAVER_LAST_CHANGED_STATUSES)
  }),

  http.post('https://api.commerce.naver.com/external/v1/pay-order/seller/product-orders/query', async ({ request }) => {
    const body = await request.json() as { productOrderIds?: string[] }
    const ids = body?.productOrderIds || []

    // Check if any of the requested IDs are claim orders
    if (ids.includes('PO-2026040201003')) {
      return HttpResponse.json(MOCK_NAVER_CLAIM_PRODUCT_ORDERS)
    }

    return HttpResponse.json(MOCK_NAVER_PRODUCT_ORDERS)
  }),

  http.post('https://api.commerce.naver.com/external/v1/pay-order/seller/product-orders/confirm', async ({ request }) => {
    const body = await request.json() as { productOrderIds?: string[] }
    return HttpResponse.json({
      data: {
        successProductOrderIds: body.productOrderIds ?? [],
        failProductOrderIds: [],
      },
    })
  }),
]

// ============================================================================
// ESM Handlers
// ============================================================================

const esmHandlers = [
  http.post('https://sa2.esmplus.com/shipping/v1/Order/RequestOrders', async ({ request }) => {
    const body = await request.json() as { siteType?: number }
    const siteType = body.siteType === 1 ? 'A' : body.siteType === 2 ? 'G' : undefined

    const filtered = siteType
      ? MOCK_ESM_ORDERS.filter((o) => o.siteType === siteType)
      : MOCK_ESM_ORDERS

    return HttpResponse.json({
      ResultCode: 0,
      Message: 'OK',
      Data: filtered,
    })
  }),

  http.get('https://etapi.ebaykorea.com/api/v1/claims', ({ request }) => {
    const url = new URL(request.url)
    const siteType = url.searchParams.get('siteType')

    const filtered = siteType
      ? MOCK_ESM_CLAIMS.filter((c) => c.siteType === siteType)
      : MOCK_ESM_CLAIMS

    return HttpResponse.json({
      resultCode: '0',
      resultMessage: 'OK',
      data: filtered,
    })
  }),

  http.post('https://sa2.esmplus.com/api/v1/orders/:orderId/delivery', () => {
    return HttpResponse.json({
      resultCode: '0',
      resultMessage: 'OK',
      data: null,
    })
  }),
]

// ============================================================================
// Ohouse Mock Data
// ============================================================================

export const MOCK_OHOUSE_ORDERS = [
  {
    orderId: 'OH-20260402-001',
    productName: '오늘의집 테스트 상품 A',
    quantity: 2,
    buyerName: '김오하우스',
    buyerPhone: '010-1234-5678',
    receiverName: '이수령',
    receiverPhone: '010-8765-4321',
    receiverZipcode: '06134',
    receiverAddress: '서울특별시 강남구 테헤란로 789',
    receiverAddressDetail: '10층 1001호',
    orderDate: '2026-04-02T10:00:00Z',
    orderStatus: 'PAID',
    paymentAmount: 59800,
    options: '색상: 네이비',
    sellerItemCode: 'SKU-OH001',
  },
  {
    orderId: 'OH-20260402-002',
    productName: '오늘의집 테스트 상품 B',
    quantity: 1,
    buyerName: '박구매',
    buyerPhone: '010-9999-8888',
    receiverName: '최배송',
    receiverPhone: '010-7777-6666',
    receiverZipcode: '48060',
    receiverAddress: '부산광역시 해운대구 우동 456',
    receiverAddressDetail: '',
    orderDate: '2026-04-02T11:00:00Z',
    orderStatus: 'SHIPPED',
    paymentAmount: 35000,
    options: '',
    sellerItemCode: 'SKU-OH002',
  },
]

export const MOCK_OHOUSE_CLAIMS = [
  {
    claimId: 'CLM-OH-001',
    orderId: 'OH-20260402-001',
    claimType: 'RETURN',
    claimStatus: 'REQUESTED',
    reason: '색상 불일치',
    createdAt: '2026-04-02T15:00:00Z',
  },
]

// ============================================================================
// Ohouse Handlers
// ============================================================================

const ohouseHandlers = [
  http.get('https://openapi.ohou.se/api/v1/orders', () => {
    return HttpResponse.json({
      success: true,
      message: 'OK',
      data: MOCK_OHOUSE_ORDERS,
    })
  }),

  http.get('https://openapi.ohou.se/api/v1/claims', () => {
    return HttpResponse.json({
      success: true,
      message: 'OK',
      data: MOCK_OHOUSE_CLAIMS,
    })
  }),

  http.post('https://openapi.ohou.se/api/v1/orders/:orderId/invoice', () => {
    return HttpResponse.json({
      success: true,
      message: 'OK',
      data: null,
    })
  }),

  http.get('https://openapi.ohou.se/api/v1/products', () => {
    return HttpResponse.json({
      success: true,
      message: 'OK',
      data: [
        { productId: 'PROD-OH-001', name: '오늘의집 상품 1', price: 29900, status: 'ACTIVE' },
      ],
    })
  }),
]

// ============================================================================
// 11st Mock Data + Handlers
// ============================================================================

export const MOCK_ELEVENST_ORDERS = [
  {
    ordNo: 'E2026040200001',
    ordPrdSeq: '1',
    prdNm: '11번가 테스트 상품 A',
    optNm: '색상: 화이트',
    ordQty: '2',
    selPrice: '15900',
    buyerNm: '김열한',
    buyerPhone: '010-1111-1111',
    rcvrNm: '박수령',
    rcvrPhone: '010-2222-2222',
    rcvrZipCd: '04524',
    rcvrBaseAddr: '서울특별시 중구 남대문로 120',
    rcvrDtlAddr: '5층 501호',
    ordDt: '2026-04-02T10:00:00Z',
    ordStCd: '202',
    dlvNo: '38600468',
  },
  {
    ordNo: 'E2026040200002',
    ordPrdSeq: '2',
    prdNm: '11번가 테스트 상품 2',
    optNm: '',
    ordQty: '1',
    selPrice: '25000',
    buyerNm: '이구매',
    buyerPhone: '010-5555-6666',
    rcvrNm: '최수령',
    rcvrPhone: '010-7777-8888',
    rcvrZipCd: '48060',
    rcvrBaseAddr: '부산광역시 해운대구 우동 222',
    rcvrDtlAddr: '',
    ordDt: '2026-04-02T11:00:00Z',
    ordStCd: '303',
    dlvNo: '38600469',
  },
]

export const MOCK_ELEVENST_CLAIMS = [
  {
    clmNo: 'CLM20260402001',
    ordNo: 'E2026040200001',
    clmTypCd: 'RTN',
    clmStCd: '100',
    clmRsnCont: '사이즈 불일치',
    clmDt: '2026-04-02T15:00:00Z',
  },
]

const elevenstHandlers = [
  http.get('https://api.11st.co.kr/rest/ordservices/complete/:dateFrom/:dateTo', () => HttpResponse.xml(`<?xml version="1.0" encoding="UTF-8"?>
<orders>
${MOCK_ELEVENST_ORDERS.map((o) => `
  <order>
    <ordNo>${o.ordNo}</ordNo>
    <ordPrdSeq>${o.ordPrdSeq}</ordPrdSeq>
    <prdNm>${o.prdNm}</prdNm>
    <optNm>${o.optNm}</optNm>
    <ordQty>${o.ordQty}</ordQty>
    <selPrice>${o.selPrice}</selPrice>
    <buyerNm>${o.buyerNm}</buyerNm>
    <buyerPhone>${o.buyerPhone}</buyerPhone>
    <rcvrNm>${o.rcvrNm}</rcvrNm>
    <rcvrPhone>${o.rcvrPhone}</rcvrPhone>
    <rcvrZipCd>${o.rcvrZipCd}</rcvrZipCd>
    <rcvrBaseAddr>${o.rcvrBaseAddr}</rcvrBaseAddr>
    <rcvrDtlAddr>${o.rcvrDtlAddr}</rcvrDtlAddr>
    <ordDt>${o.ordDt}</ordDt>
    <ordStCd>${o.ordStCd}</ordStCd>
  </order>`).join('')}
</orders>`)),

  http.get('https://api.11st.co.kr/openapi/v3/claims', () => HttpResponse.xml(`<?xml version="1.0" encoding="UTF-8"?>
<claims>
${MOCK_ELEVENST_CLAIMS.map((c) => `
  <claim>
    <clmNo>${c.clmNo}</clmNo>
    <ordNo>${c.ordNo}</ordNo>
    <clmTypCd>${c.clmTypCd}</clmTypCd>
    <clmStCd>${c.clmStCd}</clmStCd>
    <clmRsnCont>${c.clmRsnCont}</clmRsnCont>
    <clmDt>${c.clmDt}</clmDt>
  </claim>`).join('')}
</claims>`)),

  http.post('https://api.11st.co.kr/openapi/v3/orders/:orderId/delivery', () => HttpResponse.xml(`<?xml version="1.0" encoding="UTF-8"?>
<result><resultCode>200</resultCode><resultMessage>OK</resultMessage></result>`)),

  http.get('https://api.11st.co.kr/rest/ordservices/reqpackaging/:ordNo/:ordPrdSeq/:addPrdYn/:addPrdNo/:dlvNo', () => HttpResponse.xml(`<?xml version="1.0" encoding="UTF-8"?>
<ResultOrder><result_code>0</result_code><result_text>전체 1건이 정상적으로 발주처리가 되었습니다.</result_text></ResultOrder>`)),
]

// ============================================================================
// Export all handlers
// ============================================================================

export const handlers = [...coupangHandlers, ...naverHandlers, ...esmHandlers, ...ohouseHandlers, ...elevenstHandlers]
export { coupangHandlers, naverHandlers, esmHandlers, ohouseHandlers, elevenstHandlers }
