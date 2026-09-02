import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import {
  parseEcountPurchasingSnapshot,
  readEcountPurchasingRawFileRows,
  type EcountPurchasingUpload,
} from './ecount-purchasing-sync'
import {
  getNewIncrementalEcountRawRows,
  mergeEcountRawFiles,
  type StoredEcountRawFile,
} from './ecount-raw-files'

describe('mergeEcountRawFiles', () => {
  it('adds new history rows and refreshes an overlapping purchase row', async () => {
    const first = await makeUpload('구매현황-7월.xlsx', purchaseHistoryHeaders, [
      ['20260701-1', '100001-0001', '중국창고', '첫 상품', '옵션', '2026-07-01', 10, '', 'PO-001', 'P-001', '확인', '3310000000000000001'],
    ])
    const next = await makeUpload('구매현황-8월.xlsx', purchaseHistoryHeaders, [
      ['20260701-1', '100001-0001', '중국창고', '첫 상품', '옵션', '2026-07-01', 12, '', 'PO-001', 'P-001', '확인', '3310000000000000001'],
      ['20260801-1', '100002-0001', '중국창고', '새 상품', '옵션', '2026-08-01', 20, '', 'PO-002', 'P-002', '확인', '3310000000000000002'],
    ])

    const [merged] = await mergeEcountRawFiles([stored('purchaseHistory', first)], [stored('purchaseHistory', next)])
    const report = await readEcountPurchasingRawFileRows(merged)
    const newRows = await getNewIncrementalEcountRawRows(
      [stored('purchaseHistory', first)],
      [stored('purchaseHistory', next)],
      'purchaseHistory',
    )

    expect(report.rows).toHaveLength(2)
    expect(report.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ '일자-No.': '20260701-1', '구매수량(EA)': '12' }),
      expect.objectContaining({ '일자-No.': '20260801-1', '품목코드': '100002-0001' }),
    ]))
    expect(newRows).toEqual([
      expect.objectContaining({ '일자-No.': '20260801-1', '품목코드': '100002-0001' }),
    ])
  })

  it('uses the newest outbound row for the same outbound management code', async () => {
    const headers = ['품목코드', '일자-No.', '품목명', '규격', '출고수량(EA)', '유효기간', '주문서번호', '출고관리코드']
    const first = await makeUpload('중국출고-7월.xlsx', headers, [
      ['100001-0001', '20260701-1', '첫 상품', '옵션', 10, '2026-07-10', '3310000000000000001', 'OUT-001'],
    ])
    const next = await makeUpload('중국출고-8월.xlsx', headers, [
      ['100001-0001', '20260701-1', '첫 상품', '옵션', 12, '2026-07-11', '3310000000000000001', 'OUT-001'],
      ['100002-0001', '20260801-1', '새 상품', '옵션', 20, '2026-08-10', '3310000000000000002', 'OUT-002'],
    ])

    const [merged] = await mergeEcountRawFiles([stored('chinaOutbound', first)], [stored('chinaOutbound', next)])
    const report = await readEcountPurchasingRawFileRows(merged)

    expect(report.rows).toHaveLength(2)
    expect(report.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ '출고관리코드': 'OUT-001', '출고수량(EA)': '12', '유효기간': '2026-07-11' }),
      expect.objectContaining({ '출고관리코드': 'OUT-002' }),
    ]))
  })

  it('keeps china inventory as a current snapshot instead of accumulating it', async () => {
    const headers = ['품목코드', '품목명', '규격', '품목구분', '합계', '중국창고']
    const first = await makeUpload('중국재고-기존.xlsx', headers, [
      ['100001-0001', '기존 상품', '옵션', '상품', 10, 10],
    ])
    const next = await makeUpload('중국재고-최신.xlsx', headers, [
      ['100002-0001', '최신 상품', '옵션', '상품', 20, 20],
    ])

    const [merged] = await mergeEcountRawFiles([stored('chinaInventory', first)], [stored('chinaInventory', next)])
    const report = await readEcountPurchasingRawFileRows(merged)

    expect(report.rows).toEqual([
      expect.objectContaining({ '품목코드': '100002-0001', '합계': '20' }),
    ])
  })

  it('keeps orderless outbound items on the same stable key after an incremental merge', async () => {
    const headers = ['품목코드', '일자-No.', '품목명', '규격', '출고수량(EA)', '유효기간', '주문서번호', '출고관리코드']
    const first = await makeUpload('중국출고-기존.xlsx', headers, [
      ['100001-0001', '20260820-1', '첫 상품', '옵션', 10, '2026-08-20', '', ''],
    ])
    const next = await makeUpload('중국출고-추가.xlsx', headers, [
      ['100002-0001', '20260821-1', '새 상품', '옵션', 20, '2026-08-21', '', ''],
    ])
    const initialSnapshot = await parseOutboundSnapshot(first)
    const initialKey = initialSnapshot.outboundCompleted[0]?.outboundComponents[0]?.matchKey

    const [merged] = await mergeEcountRawFiles([stored('chinaOutbound', first)], [stored('chinaOutbound', next)])
    const mergedSnapshot = await parseOutboundSnapshot(merged)
    const mergedItem = mergedSnapshot.outboundCompleted.find((item) => item.sku === '100001-0001')

    expect(initialKey).toMatch(/^outbound-row:/)
    expect(mergedItem?.outboundComponents[0]?.matchKey).toBe(initialKey)
  })

  it('merges the current purchase-plan query layout without losing its aliased values', async () => {
    const legacyPlan = await makeUpload('발주계획현황.xlsx', [
      '일자-No.', '입고창고명', '품목코드', '품목명', '규격', '실 구매 수량(C)',
      '주문서번호 (C)', '구매진행여부 (C)', '구입관리코드', '현재상태',
    ], [[
      '20260902 -16', '중국창고', '100001-0001', '조회 상품', '블랙', 10,
      '3316379631024009579', '개인', 'P-QUERY', '발주계획',
    ]])
    const currentPlan = await makeUpload('ESG002M.xlsx', purchasePlanQueryHeaders, [[
      '20260902 -16', '', '', 'P-QUERY', '100001-0001', '조회 상품', '블랙', 20,
      '2026-09-09', '', '', '', '', '', '3316379631024009579', '',
      '개인', '', '', '', '', '종결', '조회', '20260902 -1',
    ]])

    const [merged] = await mergeEcountRawFiles(
      [stored('purchasePlan', legacyPlan)],
      [stored('purchasePlan', currentPlan)],
    )
    const report = await readEcountPurchasingRawFileRows(merged)
    const snapshot = await parseEcountPurchasingSnapshot({
      files: [merged],
      asOfDate: '2026-09-02',
      domesticInventoryReflectedThrough: '2026-09-02',
      allowMissingReports: true,
    })

    expect(report.rows).toEqual([
      expect.objectContaining({
        '품목코드': '100001-0001',
        규격: '블랙',
        '실 구매 수량(C)': '20',
        '주문서번호 (C)': '3316379631024009579',
        '구매진행여부 (C)': '개인',
      }),
    ])
    expect(snapshot.purchaseCompleted).toEqual([
      expect.objectContaining({
        sku: '100001-0001',
        optionName: '블랙',
        quantity: 20,
        supplierOrderNumber: '3316379631024009579',
        purchaseMethod: '개인',
      }),
    ])
  })
})

const purchaseHistoryHeaders = [
  '일자-No.', '품목코드', '창고명', '품목명', '규격', '발주계획일자', '구매수량(EA)', '중국창고 도착요청일',
  '발주서-no', '구입관리코드', '진행상태', '주문서번호 (C)',
]

const purchasePlanQueryHeaders = [
  '일자-No.', '제품특이사항', '식품용 대상여부', '구입관리코드', '품목코드', '품목명', '옵션명', '수량',
  '중국창고 도착요청일', '등급(매출기여도/재고회전률/마진률)', '일 평균 주문량', '박스(定制盒子是否需要)',
  '설명서(韩语说明书是否需要)', '판매자 강조사항 (卖家提醒内容)', '주문서번호', '판매자 출고예정일',
  '구매진행여부', '담당자명', '용도', '비고(실 필요수량)', 'URL', '종결여부', '진행상태', '발주요청일자no',
]

function stored(kind: StoredEcountRawFile['kind'], upload: EcountPurchasingUpload): StoredEcountRawFile {
  return { ...upload, kind, updatedAt: '2026-08-26T00:00:00.000Z' }
}

async function makeUpload(
  fileName: string,
  headers: string[],
  rows: Array<Array<string | number>>,
): Promise<EcountPurchasingUpload> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('원본')
  sheet.addRow(['Ecount report title'])
  sheet.addRow(headers)
  for (const row of rows) sheet.addRow(row)
  const buffer = await workbook.xlsx.writeBuffer()
  return { fileName, fileBuffer: buffer as ArrayBuffer }
}

function parseOutboundSnapshot(file: EcountPurchasingUpload) {
  return parseEcountPurchasingSnapshot({
    files: [file],
    asOfDate: '2026-08-24',
    domesticInventoryReflectedThrough: '2026-08-24',
    allowMissingReports: true,
  })
}
