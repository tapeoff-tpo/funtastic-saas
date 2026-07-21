import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { parseEcountPurchasingSnapshot, type EcountPurchasingUpload } from './ecount-purchasing-sync'

describe('parseEcountPurchasingSnapshot', () => {
  it('reads Ecount headers from row 2 and only keeps China outbound after the domestic inventory cutoff', async () => {
    const files = await Promise.all([
      makeUpload('발주 요청 현황.xlsx', [
        '일자-No.', '품목코드', '창고명', '품목명', '규격', '사전포장여부코드',
        '구매수량(EA)', '중국창고 도착요청일', '구입관리코드', '현재상태', '진행상태', '사원(담당)명',
      ], [
        ['20260715-001', '100001-0001', '중국창고', '테스트 상품', '블루', 'N', 10, '2026-07-30', 'P-001', '발주요청', '진행중', '담당자'],
        ['20260715-002', '100002-0001', '중국창고', '완료 상품', '레드', 'N', 30, '2026-07-30', 'P-002', '발주요청', '완료', '담당자'],
      ]),
      makeUpload('발주 계획 현황.xlsx', [
        '입고창고명', '품목코드', '실 구매 수량(C)', '구입관리코드', '현재상태',
      ], [
        ['중국창고', '100001-0001', 10, 'P-001', '발주계획'],
      ]),
      makeUpload('구매 현황.xlsx', [
        '발주서-no', '발주계획일자', '품목코드', '구입관리코드', '진행상태', '주문서번호 (C)',
      ], [
        ['PO-001', '2026-07-15', '100001-0001', 'P-001', '구매완료', '123456789'],
        ['PO-002', '2026-07-15', '109037-9998-package', 'P-003', '구매완료', '123456789'],
      ]),
      makeUpload('중국재고.xlsx', [
        '품목코드', '품목명', '규격', '품목구분', '합계', '중국창고',
      ], [
        ['00002', '부자재', '', '부자재', 4, 4],
        ['100001-0001', '테스트 상품', '블루', '상품', 50, 30],
      ]),
      makeUpload('중국 출고.xlsx', [
        '품목코드', '일자-No.', '품목명', '규격', '출고수량(EA)', '유효기간', '주문서번호', '출고관리코드',
      ], [
        ['100001-0001', '20260713-001', '이미 입고된 상품', '블루', 10, '2026-07-13', '123456789', 'OUT-001'],
        ['109037-9998-package', '20260715-001', '입고예정 상품', '패키지', 20, '2026-07-15', '123456789', 'OUT-002'],
        ['100002-0001', '20260720-001', '주문번호 없는 상품', '레드', 5, '2026-07-20', '', 'OUT-003'],
        ['00002', '20260720-002', '부자재 출고', '', 4, '2026-07-20', '', 'OUT-004'],
      ]),
    ])

    const snapshot = await parseEcountPurchasingSnapshot({
      files,
      domesticInventoryReflectedThrough: '2026-07-13',
    })

    expect(snapshot.activeRequests).toHaveLength(1)
    expect(snapshot.activeRequests[0]).toMatchObject({
      sku: '100001-0001',
      requestedQuantity: 10,
      purchaseManagementCode: 'P-001',
    })
    expect(snapshot.chinaInventory).toHaveLength(2)
    expect(snapshot.chinaInventory.map((item) => item.quantity)).toEqual([4, 30])
    expect(snapshot.outboundPending).toMatchObject([
      { sku: '109037-9998-package', quantity: 20, effectiveDate: '2026-07-15' },
      { sku: '100002-0001', quantity: 5, effectiveDate: '2026-07-20' },
    ])
    expect(snapshot.validation).toMatchObject({
      activeRequestsMatchedToPlan: 1,
      activeRequestsMatchedToPurchase: 1,
      outboundRowsWithSupplierOrder: 1,
      outboundRowsMatchedToPurchase: 1,
      outboundRowsWithoutReliableSupplierOrder: 1,
    })
  })
})

async function makeUpload(
  fileName: string,
  headers: string[],
  rows: Array<Array<string | number>>,
): Promise<EcountPurchasingUpload> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Sheet1')
  sheet.addRow(['Ecount report title'])
  sheet.addRow(headers)
  for (const row of rows) sheet.addRow(row)

  const buffer = await workbook.xlsx.writeBuffer()
  return {
    fileName,
    fileBuffer: buffer as ArrayBuffer,
  }
}
