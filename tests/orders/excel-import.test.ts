import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { parseOrderExcel } from '@/lib/orders/excel-import'
import { findDefaultOrderImportTemplate } from '@/lib/orders/default-import-templates'
import { normalizeImportedOrderItem } from '@/lib/orders/import-normalize'

describe('parseOrderExcel', () => {
  it('still reads product unique id when a custom template maps shipping item number', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('orders')
    sheet.addRow([
      '주문번호',
      '출고상품번호',
      '상품고유번호',
      '주문자명',
      '수령자명',
      '수령자주소',
      '주문일시',
      '상품명',
      '수량',
      '금액(원)',
    ])
    sheet.addRow([
      'O-1',
      'SHIP-ITEM-001',
      'PRODUCT-UNIQUE-001',
      '구매자',
      '수령자',
      '서울시',
      '2026-05-29 10:00:00',
      '상품',
      1,
      1000,
    ])

    const buffer = await workbook.xlsx.writeBuffer()
    const result = await parseOrderExcel(buffer, [
      { field: 'orderNumber', excelColumn: '주문번호' },
      { field: 'marketplaceItemId', excelColumn: '출고상품번호' },
      { field: 'buyerName', excelColumn: '주문자명' },
      { field: 'recipientName', excelColumn: '수령자명' },
      { field: 'recipientAddress', excelColumn: '수령자주소' },
      { field: 'orderedAt', excelColumn: '주문일시' },
      { field: 'productName', excelColumn: '상품명' },
      { field: 'quantity', excelColumn: '수량' },
      { field: 'totalAmount', excelColumn: '금액(원)' },
    ])

    expect(result.errors).toEqual([])
    expect(result.rows[0]).toMatchObject({
      marketplaceItemId: 'SHIP-ITEM-001',
      sku: 'PRODUCT-UNIQUE-001',
    })
  })

  it('selects the worksheet that best matches the Rocket Delivery default template', async () => {
    const template = findDefaultOrderImportTemplate('excel', '로켓배송')
    expect(template?.id).toBe('default:rocket-delivery')

    const workbook = new ExcelJS.Workbook()
    const summary = workbook.addWorksheet('Sheet1')
    summary.addRow(['번호', '상품이름', '발주번호'])
    summary.addRow([1, '요약 상품', '132609357'])

    const products = workbook.addWorksheet('상품목록')
    products.addRow([
      '발주번호',
      '물류센터',
      '입고유형',
      '발주상태',
      '상품번호',
      '상품바코드',
      '상품이름',
      '발주수량',
      '확정수량',
      '총발주 매입금',
      '발주등록일시',
    ])
    products.addRow([
      '132609357',
      '천안2-1',
      '쉽먼트',
      '발주확정',
      '53246845',
      'R221407410001',
      '생활살림 키치니굿즈 튐방지 가스레인지 와이드 가림막+보관파우치 세트',
      5,
      5,
      '91,500',
      '2026-05-27 08:50:41',
    ])

    const buffer = await workbook.xlsx.writeBuffer()
    const result = await parseOrderExcel(buffer, template?.mappings)

    expect(result.errors).toEqual([])
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({
      orderNumber: '132609357',
      buyerName: '로켓배송',
      recipientName: '천안2-1',
      recipientAddress: '로켓배송 물류센터',
      orderedAt: '2026-05-27 08:50:41',
      productName: '생활살림 키치니굿즈 튐방지 가스레인지 와이드 가림막+보관파우치 세트',
      optionText: '천안2-1 쉽먼트',
      quantity: 5,
      totalAmount: 91500,
      sku: 'R221407410001',
      marketplaceItemId: '53246845',
    })
  })

  it('reads the Funtastic B2B new-site order collection template', async () => {
    const template = findDefaultOrderImportTemplate('manual-test', '펀타스틱B2B (신규사이트)')
    expect(template?.id).toBe('default:funtastic-b2b-new-site')
    expect(findDefaultOrderImportTemplate('manual-test', '펀타스틱 퍼스트몰')).toBeNull()

    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('주문내역')
    sheet.addRow([
      '주문번호',
      '주문일',
      '업체명',
      '연락처',
      '상품코드',
      '상품명',
      '옵션',
      '수량',
      '단가',
      '금액',
      '배송비',
      '총금액',
      '상태',
      '수령인',
      '연락처2',
      '우편번호',
      '배송지',
      '배송메모',
      '송장번호',
      '택배사',
    ])
    sheet.addRow([
      'ORD-20260528-0003',
      '2026. 5. 28.',
      '노이엠',
      '010-3265-5232',
      '650',
      '스토션 허리 스트레칭 기구',
      '블루',
      2,
      6300,
      12600,
      3000,
      15600,
      '주문확인',
      '박혜진',
      '0502-2810-0127',
      '13374',
      '경기 성남시 중원구 둔촌대로63번길 11 102동 1208호',
      '현관앞에 놓아주세요~ 감사합니다.',
      '',
      '',
    ])

    const buffer = await workbook.xlsx.writeBuffer()
    const result = await parseOrderExcel(buffer, template?.mappings)
    const normalized = normalizeImportedOrderItem(result.rows[0], 'funtastic-b2b')

    expect(result.errors).toEqual([])
    expect(result.rows).toHaveLength(1)
    expect(normalized).toMatchObject({
      orderNumber: 'ORD-20260528-0003',
      buyerName: '노이엠',
      buyerPhone: '010-3265-5232',
      recipientName: '박혜진',
      recipientPhone: '0502-2810-0127',
      recipientAddress: '경기 성남시 중원구 둔촌대로63번길 11 102동 1208호',
      orderedAt: '2026. 5. 28.',
      productName: '스토션 허리 스트레칭 기구',
      optionText: '블루',
      quantity: 2,
      totalAmount: 12600,
      shippingFee: 3000,
      sku: '650',
      marketplaceItemId: '650',
      deliveryMessage: '현관앞에 놓아주세요~ 감사합니다.',
    })
  })
})
