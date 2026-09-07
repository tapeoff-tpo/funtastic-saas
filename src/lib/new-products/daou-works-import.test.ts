import { describe, expect, it } from 'vitest'
import {
  DAOU_WORKS_STAGE_TEMPLATE,
  normalizeDaouWorksImportItems,
  parseDaouWorksCsvText,
} from './daou-works-import'

describe('Daou WORKS CSV import', () => {
  it('groups option rows by WORKS ID and retains unmapped child data', () => {
    const parsed = parseDaouWorksCsvText([
      '"*ID","상태","제품번호","제품명","필수 체크 사항","제품 URL","등록일","수정일","옵션-옵션명","옵션-사방넷코드(옵션)","옵션-원가(위안화) (C2)","옵션-원가(원화)","옵션-MOQ 수량 (C0)","부자재 정보-부자재명","상품문의-질문내용","진행불가사유"',
      '"\"5430262\"","10.입고대기(SCM팀)","1812","테스트 상품","필수 확인","https://detail.1688.com/offer/1.html","2026-08-01 09:10:11","2026-08-03 10:20:30","화이트","112407-0001","12.5","3500","100","박스","옵션이 있나요?",""',
      '"\"5430262\"","10.입고대기(SCM팀)","1812","테스트 상품","필수 확인","https://detail.1688.com/offer/1.html","2026-08-01 09:10:11","2026-08-03 10:20:30","블랙","112407-0002","14","4200","200","박스","옵션이 있나요?",""',
    ].join('\n'))

    expect(parsed.rawRowCount).toBe(2)
    expect(parsed.items).toHaveLength(1)
    expect(parsed.statusCounts).toEqual([{ status: '10.입고대기(SCM팀)', count: 1 }])
    expect(parsed.items[0]).toMatchObject({
      sourceId: '5430262',
      sourceStatus: '10.입고대기(SCM팀)',
      values: {
        sampleCode: '1812',
        productName: '테스트 상품',
        sourceUrl: 'https://detail.1688.com/offer/1.html',
        optionDetails: [
          { optionName: '화이트', sabangnetOptionCode: '112407-0001', chinaUnitPriceCny: 12.5, costKrw: 3500 },
          { optionName: '블랙', sabangnetOptionCode: '112407-0002', chinaUnitPriceCny: 14, costKrw: 4200 },
        ],
      },
      source: {
        registeredAt: '2026-08-01T09:10:11+09:00',
        updatedAt: '2026-08-03T10:20:30+09:00',
        materialRows: [{ 부자재명: '박스' }],
        inquiryRows: [{ 질문내용: '옵션이 있나요?' }],
      },
    })
    expect(parsed.items[0]?.source.optionRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ 'MOQ 수량 (C0)': '100' }),
      expect.objectContaining({ 'MOQ 수량 (C0)': '200' }),
    ]))

    expect(normalizeDaouWorksImportItems(parsed.items)[0]?.source.updatedAt).toBe('2026-08-03T10:20:30+09:00')
  })

  it('keeps the complete WORKS stage order including empty states', () => {
    expect(DAOU_WORKS_STAGE_TEMPLATE.map((stage) => stage.name)).toEqual([
      '1.제품서치(C)',
      '2.샘플 구매대기(SCM팀)',
      '3.샘플 중국도착 대기(C)',
      '5.샘플 광주도착&본사검수(MD팀)',
      '6. 정보고시 제작 (디자인)',
      '9.구매대기(SCM팀)',
      '10.입고대기(SCM팀)',
      '11.확정원가 입력(SCM팀)',
      '12.가격 산정대기(BM팀)',
      '13.상세페이지 완료대기(디자인팀)',
      '14-1.등록대기_자사몰(SCM팀)',
      '14-2.등록대기_도매A',
      '15.등록완료',
      '90. 보류',
      '999-1. 샘플 판매요청',
      '999-2. 샘플 판매완료',
      '9999. 진행불가',
    ])
  })
})
