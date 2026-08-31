import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import {
  getEcountChinaInventorySnapshotDate,
  getEcountPurchasingRefreshScope,
  getPurchaseHistoryBridgeKey,
  getPurchaseHistoryBridgeKeysAfterChinaInventorySnapshot,
  parseEcountPurchasingSnapshot,
  type EcountPurchasingUpload,
} from './ecount-purchasing-sync'

describe('getEcountPurchasingRefreshScope', () => {
  it('rebuilds every linked purchase stage when one purchase file changes', () => {
    const planScope = getEcountPurchasingRefreshScope(['purchasePlan'])
    expect(planScope.refreshPurchasePipeline).toBe(true)
    expect(planScope.refreshOutbound).toBe(false)
    expect(planScope.sourcesToReplace).toEqual(expect.arrayContaining([
      'ecount_purchasing_snapshot_request',
      'ecount_purchasing_snapshot_request_completed',
      'ecount_purchasing_snapshot_plan_purchase_completed',
      'ecount_purchasing_snapshot_purchase_completed',
    ]))

    const historyScope = getEcountPurchasingRefreshScope(['purchaseHistory'])
    expect(historyScope.refreshPurchasePipeline).toBe(true)
    expect(historyScope.refreshOutbound).toBe(true)
  })

  it('keeps an independent inventory-only update limited to inventory', () => {
    const scope = getEcountPurchasingRefreshScope(['chinaInventory'])
    expect(scope.refreshPurchasePipeline).toBe(false)
    expect(scope.refreshOutbound).toBe(false)
    expect(scope.sourcesToReplace).toEqual([
      'ecount_purchasing_snapshot_china_arrived',
      'ecount_purchasing_snapshot_purchase_completed',
    ])
  })

  it('rebuilds only the temporary purchase-history bridge with an outbound update', () => {
    const scope = getEcountPurchasingRefreshScope(['chinaOutbound'])
    expect(scope.refreshPurchasePipeline).toBe(false)
    expect(scope.refreshOutbound).toBe(true)
    expect(scope.sourcesToReplace).toEqual(expect.arrayContaining([
      'ecount_purchasing_snapshot_purchase_completed',
      'ecount_purchasing_snapshot_outbound',
      'ecount_purchasing_snapshot_outbound_completed',
    ]))
  })
})

describe('parseEcountPurchasingSnapshot', () => {
  it('uses the printed China-inventory snapshot date to restore newer stored purchase history', async () => {
    const chinaInventory = await makeUpload(
      'ESZ018R.xlsx',
      ['품목코드', '품목명', '규격', '품목구분', '합계', '중국창고'],
      [],
      '회사명 : 테이포프 / 20260826',
    )
    const snapshotDate = await getEcountChinaInventorySnapshotDate(chinaInventory)
    const keys = getPurchaseHistoryBridgeKeysAfterChinaInventorySnapshot([
      {
        '일자-No.': '20260826-9',
        '품목코드': '112194-0001',
        '규격': '화이트',
        '발주서-no': '20260822-4',
        '구입관리코드': '20260819-110151-87',
        '진행상태': '확인',
        '주문서번호 (C)': '3316362603001063952',
      },
      {
        '일자-No.': '20260827-2',
        '품목코드': '112194-0001',
        '규격': '화이트',
        '발주서-no': '20260822-5',
        '구입관리코드': '20260819-110151-88',
        '진행상태': '확인',
        '주문서번호 (C)': '3316362603001063953',
      },
    ], snapshotDate)

    expect(snapshotDate).toBe('2026-08-26')
    expect(keys).toEqual([getPurchaseHistoryBridgeKey({
      sourceDateNo: '20260827-2',
      sku: '112194-0001',
      optionName: '화이트',
      purchaseManagementCode: '20260819-110151-88',
      purchaseOrderNumber: '20260822-5',
      supplierOrderNumber: '3316362603001063953',
    })])
  })

  it('parses a single report for a partial update without inventing other stages', async () => {
    const chinaInventory = await makeUpload('중국재고만.xlsx', [
      '품목코드', '품목명', '규격', '품목구분', '합계', '중국창고',
    ], [
      ['100001-0001', '부분 갱신 상품', '블루', '상품', 42, 42],
    ])

    const snapshot = await parseEcountPurchasingSnapshot({
      files: [chinaInventory],
      domesticInventoryReflectedThrough: '2026-08-24',
      asOfDate: '2026-08-24',
      allowMissingReports: true,
    })

    expect(snapshot.chinaInventory).toEqual([
      expect.objectContaining({ sku: '100001-0001', quantity: 42 }),
    ])
    expect(snapshot.activeRequests).toEqual([])
    expect(snapshot.purchaseCompleted).toEqual([])
    expect(snapshot.outboundPending).toEqual([])
  })

  it('maps Ecount raw rows to the current purchasing stages from row 2 headers', async () => {
    const files = await Promise.all([
      makeUpload('발주 요청 현황.xlsx', [
        '일자-No.', '품목코드', '창고명', '품목명', '규격', '사전포장여부코드',
        '구매수량(EA)', '중국창고 도착요청일', '구입관리코드', '현재상태', '진행상태', '사원(담당)명',
      ], [
        ['20260715-001', '100001-0001', '중국창고', '테스트 상품', '블루', 'N', 10, '2026-07-30', 'P-001', '발주요청', '진행중', '담당자'],
        ['20260715-002', '100002-0001', '중국창고', '완료 상품', '레드', 'N', 30, '2026-07-30', 'P-002', '발주요청', '완료', '담당자'],
        ['20260610-001', '100003-0001', '중국창고', '6월 완료 상품', '그린', 'N', 15, '2026-07-30', 'P-003', '발주요청', '완료', '담당자'],
        ['20260716-001', '100005-0001', '중국창고', '계획 누락 완료 상품', '화이트', 'N', 12, '', 'P-NOPLAN', '발주요청', '완료', '담당자'],
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
        '품목코드', '품목명', '규격', '품목구분', '합계', '부품관리', '브랜드', '중국창고',
      ], [
        ['00002', '부자재', '', '부자재', 4, 1, 0, 3],
        ['100001-0001', '테스트 상품', '블루', '상품', 50, 10, 10, 30],
        ['110115-package', '비정형 부자재', '패키지', '부자재', 7, 0, 7, 0],
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
      asOfDate: '2026-07-21',
      purchasePlanConfirmedSince: '2026-07-01',
    })

    expect(snapshot.activeRequests).toEqual([])
    expect(snapshot.chinaInventory).toHaveLength(3)
    expect(snapshot.chinaInventory.map((item) => item.quantity)).toEqual([4, 50, 7])
    expect(snapshot.chinaInventory).toContainEqual(expect.objectContaining({
      sku: '100001-0001',
      warehouseQuantities: {
        부품관리: 10,
        브랜드: 10,
        중국창고: 30,
      },
    }))
    expect(snapshot.purchaseCompleted).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: 'ecount_purchasing_snapshot_plan_purchase_completed',
        sku: '100002-0001',
        quantity: 30,
        purchaseManagementCode: 'P-002',
        chinaArrivalRequestDate: '2026-07-30',
        supplierOrderNumber: '987654321',
      }),
      expect.objectContaining({
        source: 'ecount_purchasing_snapshot_request_completed',
        sku: '100005-0001',
        quantity: 12,
        purchaseManagementCode: 'P-NOPLAN',
      }),
    ]))
    expect(snapshot.purchaseCompleted).toHaveLength(2)
    expect(snapshot.outboundCompleted).toMatchObject([
      { sku: '100001-0001', quantity: 10, effectiveDate: '2026-07-13' },
      { sku: '109037-9998-package', quantity: 20, effectiveDate: '2026-07-15' },
      { sku: '100002-0001', quantity: 5, effectiveDate: '2026-07-20' },
    ])
    expect(snapshot.outboundPending).toEqual([])
    expect(snapshot.validation).toMatchObject({
      activeRequestsMatchedToPlan: 0,
      activeRequestsMatchedToPurchase: 0,
      outboundRowsWithSupplierOrder: 2,
      outboundRowsMatchedToPurchase: 2,
      outboundRowsWithoutReliableSupplierOrder: 1,
    })
    expect(snapshot.warnings.join(' ')).not.toContain('[object Object]')
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
        ['20260716-001', '100003-0001', 'No identifier item', 'basic', 'N', 15, '', '', '', '\uC644\uB8CC', ''],
      ]),
      makeUpload('purchase-plan.xlsx', [
        '\uC77C\uC790-No.', '\uC785\uACE0\uCC3D\uACE0\uBA85', '\uD488\uBAA9\uCF54\uB4DC', '\uD488\uBAA9\uBA85', '\uADDC\uACA9',
        '\uC2E4 \uAD6C\uB9E4 \uC218\uB7C9(C)', '\uC8FC\uBB38\uC11C\uBC88\uD638 (C)', '\uAD6C\uB9E4\uC9C4\uD589\uC5EC\uBD80 (C)',
        '\uAD6C\uC785\uAD00\uB9AC\uCF54\uB4DC', '\uD604\uC7AC\uC0C1\uD0DC',
      ], [
        ['20260610-001', '\uC911\uAD6D\uCC3D\uACE0', '100001-0001', 'Past item', 'basic', 10, '', '\uAC1C\uC778', 'P-PAST', '\uBC1C\uC8FC\uACC4\uD68D'],
        ['20260715-001', '\uC911\uAD6D\uCC3D\uACE0', '100002-0001', 'Future item', 'basic', 20, '', '\uAC1C\uC778', 'P-FUTURE', '\uBC1C\uC8FC\uACC4\uD68D'],
        ['20260716-001', '\uC911\uAD6D\uCC3D\uACE0', '100003-0001', 'No identifier item', 'basic', 15, '', '\uAC1C\uC778', '', '\uBC1C\uC8FC\uACC4\uD68D'],
      ]),
      makeUpload('purchase-history.xlsx', [
        '\uC77C\uC790-No.', '\uD488\uBAA9\uCF54\uB4DC', '\uD488\uBAA9\uBA85', '\uADDC\uACA9', '\uBC1C\uC8FC\uACC4\uD68D\uC77C\uC790',
        '\uAD6C\uB9E4\uC218\uB7C9(EA)', '\uC911\uAD6D\uCC3D\uACE0 \uB3C4\uCC29\uC694\uCCAD\uC77C',
        '\uBC1C\uC8FC\uC11C-no', '\uAD6C\uC785\uAD00\uB9AC\uCF54\uB4DC', '\uC9C4\uD589\uC0C1\uD0DC', '\uC8FC\uBB38\uC11C\uBC88\uD638 (C)',
      ], [
        ['20260717-001', '100003-0001', 'No identifier item', 'basic', '2026-07-16', 15, '', '', '', '\uD655\uC778', ''],
      ]),
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
    expect(snapshot.purchaseCompleted).not.toContainEqual(expect.objectContaining({
      sku: '100003-0001',
    }))
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

  it('does not consume a newer plan with an older purchase when management codes conflict', async () => {
    const files = await Promise.all([
      makeUpload('purchase-request.xlsx', [
        '일자-No.', '품목코드', '품목명', '규격', '사전포장여부코드', '구매수량(EA)',
        '중국창고 도착요청일', '구입관리코드', '현재상태', '진행상태', '사원(담당)명',
      ], [
        ['20260729-8', '101542-0001', 'CABOSS 미니스텝퍼', '블랙', 'N', 400, '', '20260729-110151-9', '', '완료', ''],
      ]),
      makeUpload('purchase-plan.xlsx', [
        '일자-No.', '입고창고명', '품목코드', '품목명', '규격', '실 구매 수량(C)',
        '주문서번호 (C)', '구매진행여부 (C)', '구입관리코드', '현재상태',
      ], [
        ['20260807-1', '중국창고', '101542-0001', 'CABOSS 미니스텝퍼', '블랙', 400, '웨이신', '', '20260729-110151-9', '발주계획'],
      ]),
      makeUpload('purchase-history.xlsx', [
        '일자-No.', '품목코드', '품목명', '규격', '발주계획일자', '구매수량(EA)',
        '중국창고 도착요청일', '발주서-no', '구입관리코드', '진행상태', '주문서번호 (C)',
      ], [
        ['20260720-22', '101542-0001', 'CABOSS 미니스텝퍼', '블랙', '2026-07-20', 400, '', '20260720-33', '20260625-110151-17', '확인', '웨이신'],
      ]),
      makeUpload('china-inventory.xlsx', [
        '품목코드', '품목명', '규격', '품목구분', '합계', '중국창고',
      ], []),
      makeUpload('china-outbound.xlsx', [
        '품목코드', '일자-No.', '품목명', '규격', '출고수량(EA)', '유효기간', '주문서번호', '출고관리코드',
      ], []),
    ])

    const snapshot = await parseEcountPurchasingSnapshot({
      files,
      domesticInventoryReflectedThrough: '2026-08-20',
      asOfDate: '2026-08-21',
      purchasePlanConfirmedSince: '2026-07-01',
    })

    expect(snapshot.purchaseCompleted).toContainEqual(expect.objectContaining({
      source: 'ecount_purchasing_snapshot_plan_purchase_completed',
      sku: '101542-0001',
      quantity: 400,
      purchaseManagementCode: '20260729-110151-9',
    }))
  })

  it('matches by supplier order number and sku regardless of quantity differences', async () => {
    const files = await Promise.all([
      makeUpload('purchase-request.xlsx', [
        '일자-No.', '품목코드', '품목명', '규격', '사전포장여부코드', '구매수량(EA)',
        '중국창고 도착요청일', '구입관리코드', '현재상태', '진행상태', '사원(담당)명',
      ], [
        ['20260708-4', '101920-0001', '거품수세미', '2개입', 'Y', 1200, '', 'P-1', '', '완료', ''],
      ]),
      makeUpload('purchase-plan.xlsx', [
        '일자-No.', '입고창고명', '품목코드', '품목명', '규격', '실 구매 수량(C)',
        '주문서번호 (C)', '구매진행여부 (C)', '구입관리코드', '현재상태',
      ], [
        ['20260708-21', '중국창고', '101920-0001', '거품수세미', '2개입', 1200, '3311769613413009579', '개인', 'P-1', '발주계획'],
      ]),
      makeUpload('purchase-history.xlsx', [
        '일자-No.', '품목코드', '품목명', '규격', '발주계획일자', '구매수량(EA)',
        '중국창고 도착요청일', '발주서-no', '구입관리코드', '진행상태', '주문서번호 (C)',
      ], [
        ['20260713-30', '101920-0001', '거품수세미', '2개입', '', 400, '', '', 'P-1', '확인', '3311769613413009579'],
      ]),
      makeUpload('china-inventory.xlsx', [
        '품목코드', '품목명', '규격', '품목구분', '합계', '중국창고',
      ], []),
      makeUpload('china-outbound.xlsx', [
        '품목코드', '일자-No.', '품목명', '규격', '출고수량(EA)', '유효기간', '주문서번호', '출고관리코드',
      ], [
        ['101920-0001', '20260714-1', '거품수세미', '2개입', 400, '2026-07-15', '3311769613413009579', 'OUT-1'],
      ]),
    ])

    const snapshot = await parseEcountPurchasingSnapshot({
      files,
      domesticInventoryReflectedThrough: '2026-07-15',
      asOfDate: '2026-07-21',
      purchasePlanConfirmedSince: '2026-07-01',
    })

    expect(snapshot.purchaseCompleted).not.toContainEqual(expect.objectContaining({
      sku: '101920-0001',
    }))
  })

  it('keeps a newly arrived purchase in the pipeline despite older China stock for the same SKU', async () => {
    const files = await Promise.all([
      makeUpload('purchase-plan.xlsx', [
        '일자-No.', '입고창고명', '품목코드', '품목명', '규격', '실 구매 수량(C)',
        '주문서번호 (C)', '구매진행여부 (C)', '구입관리코드', '현재상태',
      ], [
        ['20260820-17', '중국창고', '112194-0001', '히카리 슬림형 쌀통', '화이트', 20, '3316362603001063953', '개인', '20260819-110151-88', '발주계획'],
      ]),
      makeUpload('purchase-history.xlsx', [
        '일자-No.', '품목코드', '품목명', '규격', '발주계획일자', '구매수량(EA)',
        '중국창고 도착요청일', '발주서-no', '구입관리코드', '진행상태', '주문서번호 (C)',
      ], [
        ['20260827-2', '112194-0001', '히카리 슬림형 쌀통', '화이트', '2026-08-20', 20, '', '', '20260819-110151-88', '확인', '3316362603001063953'],
      ]),
      makeUpload('china-inventory.xlsx', [
        '품목코드', '품목명', '규격', '품목구분', '합계', '중국창고',
      ], [
        ['112194-0001', '히카리 슬림형 쌀통', '화이트', '상품', 7, 7],
      ]),
      makeUpload('china-outbound.xlsx', [
        '품목코드', '일자-No.', '품목명', '규격', '출고수량(EA)', '유효기간', '주문서번호', '출고관리코드',
      ], []),
    ])

    const snapshot = await parseEcountPurchasingSnapshot({
      files,
      domesticInventoryReflectedThrough: '2026-08-26',
      asOfDate: '2026-08-27',
      allowMissingReports: true,
      purchaseHistoryBridgeKeys: [getPurchaseHistoryBridgeKey({
        sourceDateNo: '20260827-2',
        sku: '112194-0001',
        optionName: '화이트',
        purchaseManagementCode: '20260819-110151-88',
        purchaseOrderNumber: null,
        supplierOrderNumber: '3316362603001063953',
      })],
    })

    expect(snapshot.purchaseCompleted).toContainEqual(expect.objectContaining({
      source: 'ecount_purchasing_snapshot_purchase_completed',
      sku: '112194-0001',
      quantity: 20,
      purchaseManagementCode: '20260819-110151-88',
      supplierOrderNumber: '3316362603001063953',
    }))
    expect(snapshot.purchaseCompleted
      .filter((item) => item.sku === '112194-0001')
      .reduce((sum, item) => sum + item.quantity, 0))
      .toBe(20)
  })

  it('removes a temporary purchase-history bridge when the same order is in China outbound', async () => {
    const files = await Promise.all([
      makeUpload('purchase-history.xlsx', [
        '일자-No.', '품목코드', '품목명', '규격', '발주계획일자', '구매수량(EA)',
        '중국창고 도착요청일', '발주서-no', '구입관리코드', '진행상태', '주문서번호 (C)',
      ], [
        ['20260827-2', '112194-0001', '히카리 슬림형 쌀통', '화이트', '2026-08-20', 20, '', 'PO-88', '20260819-110151-88', '확인', '3316362603001063953'],
      ]),
      makeUpload('china-outbound.xlsx', [
        '품목코드', '일자-No.', '품목명', '규격', '출고수량(EA)', '유효기간',
        '구입관리코드', '주문서번호', '출고관리코드',
      ], [
        ['112194-0001', '20260828-1', '히카리 슬림형 쌀통', '화이트', 20, '2026-08-28', 'OTHER-CODE', '3316362603001063953', 'OUT-88'],
      ]),
    ])

    const snapshot = await parseEcountPurchasingSnapshot({
      files,
      domesticInventoryReflectedThrough: '2026-08-27',
      asOfDate: '2026-08-28',
      allowMissingReports: true,
      purchaseHistoryBridgeKeys: [getPurchaseHistoryBridgeKey({
        sourceDateNo: '20260827-2',
        sku: '112194-0001',
        optionName: '화이트',
        purchaseManagementCode: '20260819-110151-88',
        purchaseOrderNumber: 'PO-88',
        supplierOrderNumber: '3316362603001063953',
      })],
    })

    expect(snapshot.purchaseCompleted).not.toContainEqual(expect.objectContaining({
      source: 'ecount_purchasing_snapshot_purchase_completed',
      sku: '112194-0001',
    }))
  })

  it('keeps the unshipped remainder of a split China outbound in the bridge', async () => {
    const files = await Promise.all([
      makeUpload('purchase-history.xlsx', [
        '일자-No.', '품목코드', '품목명', '규격', '발주계획일자', '구매수량(EA)',
        '중국창고 도착요청일', '발주서-no', '구입관리코드', '진행상태', '주문서번호 (C)',
      ], [
        ['20260827-2', '112194-0001', '히카리 슬림형 쌀통', '화이트', '2026-08-20', 100, '', 'PO-88', '20260819-110151-88', '확인', '3316362603001063953'],
      ]),
      makeUpload('china-outbound.xlsx', [
        '품목코드', '일자-No.', '품목명', '규격', '출고수량(EA)', '유효기간',
        '구입관리코드', '주문서번호', '출고관리코드',
      ], [
        ['112194-0001', '20260828-1', '히카리 슬림형 쌀통', '화이트', 40, '2026-08-28', '20260819-110151-88', '3316362603001063953', 'OUT-88'],
      ]),
    ])

    const snapshot = await parseEcountPurchasingSnapshot({
      files,
      domesticInventoryReflectedThrough: '2026-08-27',
      asOfDate: '2026-08-28',
      allowMissingReports: true,
      purchaseHistoryBridgeKeys: [getPurchaseHistoryBridgeKey({
        sourceDateNo: '20260827-2',
        sku: '112194-0001',
        optionName: '화이트',
        purchaseManagementCode: '20260819-110151-88',
        purchaseOrderNumber: 'PO-88',
        supplierOrderNumber: '3316362603001063953',
      })],
    })

    expect(snapshot.purchaseCompleted).toContainEqual(expect.objectContaining({
      source: 'ecount_purchasing_snapshot_purchase_completed',
      sku: '112194-0001',
      quantity: 60,
    }))
    expect(snapshot.outboundCompleted).toContainEqual(expect.objectContaining({
      sku: '112194-0001',
      quantity: 40,
    }))
  })

  it('matches orderless outbound rows by purchase management code and sku', async () => {
    const files = await Promise.all([
      makeUpload('purchase-history.xlsx', [
        '일자-No.', '품목코드', '품목명', '규격', '발주계획일자', '구매수량(EA)',
        '중국창고 도착요청일', '발주서-no', '구입관리코드', '진행상태', '주문서번호 (C)',
      ], [
        ['20260820-1', '101920-0001', '거품수세미', '2개입', '', 400, '', '', 'P-1', '확인', ''],
      ]),
      makeUpload('china-outbound.xlsx', [
        '품목코드', '일자-No.', '품목명', '규격', '출고수량(EA)', '유효기간',
        '구입관리코드', '주문서번호', '출고관리코드',
      ], [
        ['101920-0001', '20260821-1', '거품수세미', '2개입', 400, '2026-08-21', 'P-1', '', 'OUT-1'],
      ]),
    ])

    const snapshot = await parseEcountPurchasingSnapshot({
      files,
      domesticInventoryReflectedThrough: '2026-08-21',
      asOfDate: '2026-08-21',
      allowMissingReports: true,
    })

    expect(snapshot.outboundCompleted).toEqual([
      expect.objectContaining({
        sku: '101920-0001',
        purchaseManagementCode: 'P-1',
        purchasedQuantity: 400,
        isFullyOutbound: true,
      }),
    ])
    expect(snapshot.validation).toMatchObject({
      outboundRowsWithSupplierOrder: 0,
      outboundRowsMatchedToPurchase: 1,
      outboundRowsWithoutReliableSupplierOrder: 1,
    })
  })

  it('matches the same supplier order and sku even when option labels differ', async () => {
    const files = await Promise.all([
      makeUpload('purchase-plan.xlsx', [
        '일자-No.', '입고창고명', '품목코드', '품목명', '규격', '실 구매 수량(C)',
        '주문서번호 (C)', '구매진행여부 (C)', '구입관리코드', '현재상태',
      ], [
        ['20260722-16', '중국창고', '111896-0001', '창틀 청소브러쉬', '창틀청소기', 20, '3315527619767009579', '개인', 'P-64', '발주계획'],
      ]),
      makeUpload('purchase-history.xlsx', [
        '일자-No.', '품목코드', '품목명', '규격', '발주계획일자', '구매수량(EA)',
        '중국창고 도착요청일', '발주서-no', '구입관리코드', '진행상태', '주문서번호 (C)',
      ], [
        ['20260810-2', '111896-0001', '창틀 청소브러쉬', '창틀청소기 2개입', '', 20, '', '', 'P-64', '확인', '3315527619767009579'],
      ]),
    ])

    const snapshot = await parseEcountPurchasingSnapshot({
      files,
      domesticInventoryReflectedThrough: '2026-08-24',
      asOfDate: '2026-08-24',
      allowMissingReports: true,
    })

    expect(snapshot.purchaseCompleted).not.toContainEqual(expect.objectContaining({
      sku: '111896-0001',
    }))
  })

  it('keeps every distinct purchase-in-progress order for the same sku', async () => {
    const files = await Promise.all([
      makeUpload('purchase-plan.xlsx', [
        '일자-No.', '입고창고명', '품목코드', '품목명', '규격', '실 구매 수량(C)',
        '주문서번호 (C)', '구매진행여부 (C)', '구입관리코드', '현재상태',
      ], [
        ['20260702-32', '중국창고', '110806-0001', '폰디 북마커', '3종', 20, '5122655749206006728', '법인', 'P-OLD', '발주계획'],
        ['20260804-2', '중국창고', '110806-0001', '폰디 북마커', '3종', 20, '3315471351420009579', '개인', 'P-NEW', '발주계획'],
      ]),
    ])

    const snapshot = await parseEcountPurchasingSnapshot({
      files,
      domesticInventoryReflectedThrough: '2026-08-24',
      asOfDate: '2026-08-24',
      allowMissingReports: true,
    })

    expect(snapshot.purchaseCompleted).toEqual([
      expect.objectContaining({
        sku: '110806-0001',
        supplierOrderNumber: '5122655749206006728',
        purchaseDate: '2026-07-02',
      }),
      expect.objectContaining({
        sku: '110806-0001',
        supplierOrderNumber: '3315471351420009579',
        purchaseDate: '2026-08-04',
      }),
    ])
  })

  it('does not discard an unmatched older order just because a newer order arrived', async () => {
    const files = await Promise.all([
      makeUpload('purchase-request.xlsx', [
        '일자-No.', '품목코드', '품목명', '규격', '사전포장여부코드', '구매수량(EA)',
        '중국창고 도착요청일', '구입관리코드', '현재상태', '진행상태', '사원(담당)명',
      ], [
        ['20260702-86', '111697-0001', '비안스 받침대', '화이트', 'Y', 150, '', 'P-OLD', '', '완료', ''],
      ]),
      makeUpload('purchase-plan.xlsx', [
        '일자-No.', '입고창고명', '품목코드', '품목명', '규격', '실 구매 수량(C)',
        '주문서번호 (C)', '구매진행여부 (C)', '구입관리코드', '현재상태',
      ], [
        ['20260806-8', '중국창고', '111697-0001', '비안스 받침대', '화이트', 150, '3315604479129009579', '개인', 'P-NEW', '발주계획'],
      ]),
      makeUpload('purchase-history.xlsx', [
        '일자-No.', '품목코드', '품목명', '규격', '발주계획일자', '구매수량(EA)',
        '중국창고 도착요청일', '발주서-no', '구입관리코드', '진행상태', '주문서번호 (C)',
      ], [
        ['20260813-6', '111697-0001', '비안스 받침대', '화이트', '', 150, '', '', 'P-NEW', '확인', '3315604479129009579'],
      ]),
    ])

    const snapshot = await parseEcountPurchasingSnapshot({
      files,
      domesticInventoryReflectedThrough: '2026-08-24',
      asOfDate: '2026-08-24',
      allowMissingReports: true,
    })

    expect(snapshot.purchaseCompleted).toContainEqual(expect.objectContaining({
      sku: '111697-0001',
      purchaseManagementCode: 'P-OLD',
      quantity: 150,
    }))
  })

  it('aggregates split outbound rows per order, sku, and date and tracks cumulative completion', async () => {
    const files = await Promise.all([
      makeUpload('purchase-history.xlsx', [
        '일자-No.', '품목코드', '품목명', '규격', '발주계획일자', '구매수량(EA)',
        '중국창고 도착요청일', '발주서-no', '구입관리코드', '진행상태', '주문서번호 (C)',
      ], [
        ['20260820-1', '100001-0001', '분리출고 상품', '', '', 100, '', '', 'P-1', '확인', '3310000000000000001'],
      ]),
      makeUpload('china-outbound.xlsx', [
        '품목코드', '일자-No.', '품목명', '규격', '출고수량(EA)', '유효기간', '주문서번호', '출고관리코드',
      ], [
        ['100001-0001', '20260820-1', '분리출고 상품', '', 30, '2026-08-20', '3310000000000000001', 'OUT-1'],
        ['100001-0001', '20260820-2', '분리출고 상품', '', 20, '2026-08-20', '3310000000000000001', 'OUT-2'],
        ['100001-0001', '20260822-1', '분리출고 상품', '', 50, '2026-08-22', '3310000000000000001', 'OUT-3'],
      ]),
    ])

    const snapshot = await parseEcountPurchasingSnapshot({
      files,
      domesticInventoryReflectedThrough: '2026-08-24',
      asOfDate: '2026-08-24',
      allowMissingReports: true,
    })

    expect(snapshot.outboundCompleted).toHaveLength(2)
    expect(snapshot.outboundCompleted[0]).toMatchObject({
      effectiveDate: '2026-08-20',
      quantity: 50,
      cumulativeOutboundQuantity: 50,
      totalOutboundQuantity: 100,
      purchasedQuantity: 100,
      isFullyOutbound: false,
    })
    expect(snapshot.outboundCompleted[0].componentMatchKeys).toHaveLength(2)
    expect(snapshot.outboundCompleted[1]).toMatchObject({
      effectiveDate: '2026-08-22',
      quantity: 50,
      cumulativeOutboundQuantity: 100,
      totalOutboundQuantity: 100,
      purchasedQuantity: 100,
      isFullyOutbound: true,
    })
  })
})

async function makeUpload(
  fileName: string,
  headers: string[],
  rows: Array<Array<string | number>>,
  reportHeader = 'Ecount report title',
): Promise<EcountPurchasingUpload> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Sheet1')
  sheet.addRow([reportHeader])
  sheet.addRow(headers)
  for (const row of rows) sheet.addRow(row)

  const buffer = await workbook.xlsx.writeBuffer()
  return {
    fileName,
    fileBuffer: buffer as ArrayBuffer,
  }
}
