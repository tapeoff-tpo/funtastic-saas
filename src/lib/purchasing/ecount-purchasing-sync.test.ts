import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { parseEcountPurchasingSnapshot, type EcountPurchasingUpload } from './ecount-purchasing-sync'

describe('parseEcountPurchasingSnapshot', () => {
  it('maps Ecount raw rows to the current purchasing stages from row 2 headers', async () => {
    const files = await Promise.all([
      makeUpload('발주 요청 현황.xlsx', [
        '일자-No.', '품목코드', '창고명', '품목명', '규격', '사전포장여부코드',
        '구매수량(EA)', '중국창고 도착요청일', '구입관리코드', '현재상태', '진행상태', '사원(담당)명',
      ], [
        ['20260715-001', '100001-0001', '중국창고', '테스트 상품', '블루', 'N', 10, '2026-07-30', 'P-001', '발주요청', '진행중', '담당자'],
        ['20260715-002', '100002-0001', '중국창고', '완료 상품', '레드', 'N', 30, '2026-07-30', 'P-002', '발주요청', '완료', '담당자'],
        ['20260610-001', '100003-0001', '중국창고', '6월 완료 상품', '그린', 'N', 15, '2026-07-30', 'P-003', '발주요청', '완료', '담당자'],
      ]),
      makeUpload('발주 계획 현황.xlsx', [
        '일자-No.', '입고창고명', '품목코드', '품목명', '규격', '실 구매 수량(C)',
        '주문서번호 (C)', '구매진행여부 (C)', '구입관리코드', '현재상태',
      ], [
        ['20260715-001', '중국창고', '100001-0001', '테스트 상품', '블루', 10, '123456789', '개인', 'P-001', '발주계획'],
        ['20260715-002', '중국창고', '100002-0001', '완료 상품', '레드', 30, '987654321', '개인', 'P-002', '발주계획'],
        ['20260610-001', '중국창고', '100003-0001', '6월 완료 상품', '그린', 15, '', '개인', 'P-003', '발주계획'],
      ]),
      makeUpload('구매 현황.xlsx', [
        '일자-No.', '품목코드', '창고명', '품목명', '규격', '발주계획일자', '구매수량(EA)', '중국창고 도착요청일',
        '발주서-no', '구입관리코드', '진행상태', '주문서번호 (C)',
      ], [
        ['20260715-001', '100001-0001', '중국창고', '테스트 상품', '블루', '2026-07-15', 10, '2026-07-30', 'PO-001', 'P-001', '확인', '123456789'],
        ['20260715-002', '109037-9998-package', '중국창고', '패키지 상품', '패키지', '2026-07-15', 20, '2026-07-12', 'PO-002', 'P-003', '확인', '123456789'],
        ['20260610-003', '100003-0001', '중국창고', '6월 완료 상품', '그린', '2026-06-10', 15, '2026-06-20', 'PO-003', 'P-003', '확인', ''],
        ['20260610-002', '100004-0001', '중국창고', '도착예정 상품', '옐로우', '2026-06-10', 25, '2026-07-30', 'PO-OLD', 'P-OLD', '확인', '998877665544'],
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
        ['100002-0001', '20260720-001', '주문번호 있는 상품', '레드', 5, '2026-07-20', '987654321', 'OUT-003'],
        ['00002', '20260720-002', '부자재 출고', '', 4, '2026-07-20', '', 'OUT-004'],
      ]),
    ])

    const snapshot = await parseEcountPurchasingSnapshot({
      files,
      domesticInventoryReflectedThrough: '2026-07-13',
      asOfDate: '2026-07-21',
      purchasePlanConfirmedSince: '2026-07-01',
    })

    expect(snapshot.activeRequests).toHaveLength(1)
    expect(snapshot.activeRequests[0]).toMatchObject({
      sku: '100001-0001',
      requestedQuantity: 10,
      purchaseManagementCode: 'P-001',
    })
    expect(snapshot.chinaInventory).toHaveLength(2)
    expect(snapshot.chinaInventory.map((item) => item.quantity)).toEqual([4, 30])
    expect(snapshot.purchaseCompleted).toHaveLength(3)
    expect(snapshot.purchaseCompleted).toContainEqual(expect.objectContaining(
      {
        source: 'ecount_purchasing_snapshot_plan_purchase_completed',
        sku: '100002-0001',
        quantity: 25,
        purchaseManagementCode: 'P-002',
        chinaArrivalRequestDate: '2026-07-30',
        supplierOrderNumber: '987654321',
      },
    ))
    expect(snapshot.purchaseCompleted).toContainEqual(expect.objectContaining(
      {
        source: 'ecount_purchasing_snapshot_plan_purchase_completed',
        sku: '100003-0001',
        quantity: 15,
        purchaseManagementCode: 'P-003',
      },
    ))
    expect(snapshot.purchaseCompleted).toContainEqual(expect.objectContaining(
      {
        source: 'ecount_purchasing_snapshot_purchase_completed',
        sku: '100004-0001',
        quantity: 25,
        purchaseManagementCode: 'P-OLD',
        chinaArrivalRequestDate: '2026-07-30',
      },
    ))
    expect(snapshot.outboundCompleted).toMatchObject([
      { sku: '100001-0001', quantity: 10, effectiveDate: '2026-07-13' },
    ])
    expect(snapshot.outboundPending).toMatchObject([
      { sku: '109037-9998-package', quantity: 20, effectiveDate: '2026-07-15' },
      { sku: '100002-0001', quantity: 5, effectiveDate: '2026-07-20' },
    ])
    expect(snapshot.validation).toMatchObject({
      activeRequestsMatchedToPlan: 1,
      activeRequestsMatchedToPurchase: 1,
      outboundRowsWithSupplierOrder: 2,
      outboundRowsMatchedToPurchase: 1,
      outboundRowsWithoutReliableSupplierOrder: 0,
    })
  })

  it('keeps plan rows regardless of their arrival target date and preserves the source purchase date', async () => {
    const files = await Promise.all([
      makeUpload('purchase-request.xlsx', [
        '\uC77C\uC790-No.', '\uD488\uBAA9\uCF54\uB4DC', '\uD488\uBAA9\uBA85', '\uADDC\uACA9',
        '\uC0AC\uC804\uD3EC\uC7A5\uC5EC\uBD80\uCF54\uB4DC', '\uAD6C\uB9E4\uC218\uB7C9(EA)',
        '\uC911\uAD6D\uCC3D\uACE0 \uB3C4\uCC29\uC694\uCCAD\uC77C', '\uAD6C\uC785\uAD00\uB9AC\uCF54\uB4DC',
        '\uD604\uC7AC\uC0C1\uD0DC', '\uC9C4\uD589\uC0C1\uD0DC', '\uC0AC\uC6D0(\uB2F4\uB2F9)\uBA85',
      ], [
        ['20260610-001', '100001-0001', 'Past item', 'basic', 'N', 10, '2026-07-20', 'P-PAST', '', '\uC644\uB8CC', ''],
        ['20260715-001', '100002-0001', 'Future item', 'basic', 'N', 20, '2026-07-30', 'P-FUTURE', '', '\uC644\uB8CC', ''],
      ]),
      makeUpload('purchase-plan.xlsx', [
        '\uC77C\uC790-No.', '\uC785\uACE0\uCC3D\uACE0\uBA85', '\uD488\uBAA9\uCF54\uB4DC', '\uD488\uBAA9\uBA85', '\uADDC\uACA9',
        '\uC2E4 \uAD6C\uB9E4 \uC218\uB7C9(C)', '\uC8FC\uBB38\uC11C\uBC88\uD638 (C)', '\uAD6C\uB9E4\uC9C4\uD589\uC5EC\uBD80 (C)',
        '\uAD6C\uC785\uAD00\uB9AC\uCF54\uB4DC', '\uD604\uC7AC\uC0C1\uD0DC',
      ], [
        ['20260610-001', '\uC911\uAD6D\uCC3D\uACE0', '100001-0001', 'Past item', 'basic', 10, '', '\uAC1C\uC778', 'P-PAST', '\uBC1C\uC8FC\uACC4\uD68D'],
        ['20260715-001', '\uC911\uAD6D\uCC3D\uACE0', '100002-0001', 'Future item', 'basic', 20, '', '\uAC1C\uC778', 'P-FUTURE', '\uBC1C\uC8FC\uACC4\uD68D'],
      ]),
      makeUpload('purchase-history.xlsx', [
        '\uC77C\uC790-No.', '\uD488\uBAA9\uCF54\uB4DC', '\uD488\uBAA9\uBA85', '\uADDC\uACA9', '\uBC1C\uC8FC\uACC4\uD68D\uC77C\uC790',
        '\uAD6C\uB9E4\uC218\uB7C9(EA)', '\uC911\uAD6D\uCC3D\uACE0 \uB3C4\uCC29\uC694\uCCAD\uC77C',
        '\uBC1C\uC8FC\uC11C-no', '\uAD6C\uC785\uAD00\uB9AC\uCF54\uB4DC', '\uC9C4\uD589\uC0C1\uD0DC', '\uC8FC\uBB38\uC11C\uBC88\uD638 (C)',
      ], []),
      makeUpload('china-inventory.xlsx', [
        '\uD488\uBAA9\uCF54\uB4DC', '\uD488\uBAA9\uBA85', '\uADDC\uACA9', '\uD488\uBAA9\uAD6C\uBD84', '\uD569\uACC4', '\uC911\uAD6D\uCC3D\uACE0',
      ], []),
      makeUpload('china-outbound.xlsx', [
        '\uD488\uBAA9\uCF54\uB4DC', '\uC77C\uC790-No.', '\uD488\uBAA9\uBA85', '\uADDC\uACA9', '\uCD9C\uACE0\uC218\uB7C9(EA)',
        '\uC720\uD6A8\uAE30\uAC04', '\uC8FC\uBB38\uC11C\uBC88\uD638', '\uCD9C\uACE0\uAD00\uB9AC\uCF54\uB4DC',
      ], []),
    ])

    const snapshot = await parseEcountPurchasingSnapshot({
      files,
      domesticInventoryReflectedThrough: '2026-07-13',
      asOfDate: '2026-07-21',
    })

    expect(snapshot.purchaseCompleted).toHaveLength(2)
    expect(snapshot.purchaseCompleted).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sku: '100001-0001',
        purchaseManagementCode: 'P-PAST',
        purchaseDate: '2026-06-10',
        chinaArrivalRequestDate: '2026-07-20',
      }),
      expect.objectContaining({
        sku: '100002-0001',
        purchaseManagementCode: 'P-FUTURE',
        purchaseDate: '2026-07-15',
        chinaArrivalRequestDate: '2026-07-30',
      }),
    ]))
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
