import { describe, expect, it } from 'vitest'
import {
  DAOU_WORKS_SUGGESTED_SAAS_STAGE_NAMES,
  DAOU_WORKS_STAGE_TEMPLATE,
  normalizeDaouWorksImportItems,
  parseDaouWorksCsvText,
  splitDaouWorksRequiredChecks,
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

  it('does not turn free-form cost notes into an amount', () => {
    const parsed = parseDaouWorksCsvText([
      '"*ID","상태","제품명","예상원가"',
      '"5430263","1.제품서치(C)","테스트 상품","221104 BM유지연 단가 80위안(20,000원)"',
    ].join('\n'))

    expect(parsed.items[0]?.values.estimatedCost).toBeNull()
  })

  it('moves only the keyword block while retaining later meeting notes in required checks', () => {
    const parsed = parseDaouWorksCsvText([
      '"*ID","상태","제품명","필수 체크 사항","히스토리","비고 (참고사항)"',
      '"5430265","1.제품서치(C)","테스트 상품","키워드\n노트,수첩,문구\n\n\n26년 3월 26일 소싱회의 통과\n方块本-黄色-yellow","샘플 구매 완료","상세페이지 참고"',
    ].join('\n'))

    expect(parsed.items[0]?.values).toMatchObject({
      productKeywords: '노트,수첩,문구',
      requiredChecks: '26년 3월 26일 소싱회의 통과\n方块本-黄色-yellow',
      historyNotes: null,
      referenceNotes: '히스토리: 샘플 구매 완료\n\n비고: 상세페이지 참고',
    })
  })

  it('retains required-check text that is not marked as a keyword block', () => {
    expect(splitDaouWorksRequiredChecks('26년 3월 26일 소싱회의 통과\n方块本-黄色-yellow')).toEqual({
      requiredChecks: '26년 3월 26일 소싱회의 통과\n方块本-黄色-yellow',
      productKeywords: null,
    })
  })

  it('does not carry removed package size fields into option data', () => {
    const parsed = parseDaouWorksCsvText([
      '"*ID","상태","제품명","옵션-옵션명","옵션-제품 낱개 패키지 사이즈 (C6)","옵션-벌크 사이즈 (C4)"',
      '"5430264","1.제품서치(C)","테스트 상품","화이트","60*48*43","72*56*46"',
    ].join('\n'))

    const option = parsed.items[0]?.values.optionDetails[0]
    expect(option).toMatchObject({ optionName: '화이트' })
    expect(option).not.toHaveProperty('productSize')
    expect(option).not.toHaveProperty('bulkSize')
  })

  it('keeps the complete WORKS stage order including empty states', () => {
    expect(DAOU_WORKS_STAGE_TEMPLATE.map((stage) => stage.name)).toEqual([
      '1.제품서치(C)',
      '2.샘플 구매대기(SCM팀)',
      '3.샘플 중국도착 대기(C)',
      '5.샘플 광주도착&본사검수(MD팀)',
      '6. 정보고시 제작 (디자인)',
      '7.사방넷 제품등록(SCM팀)',
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

  it('suggests the approved SaaS stage for every WORKS status', () => {
    expect(Object.keys(DAOU_WORKS_SUGGESTED_SAAS_STAGE_NAMES)).toEqual(DAOU_WORKS_STAGE_TEMPLATE.map((stage) => stage.name))
    expect(DAOU_WORKS_SUGGESTED_SAAS_STAGE_NAMES['2.샘플 구매대기(SCM팀)']).toBe('샘플 구매 대기')
    expect(DAOU_WORKS_SUGGESTED_SAAS_STAGE_NAMES['10.입고대기(SCM팀)']).toBe('상품 입고 대기')
    expect(DAOU_WORKS_SUGGESTED_SAAS_STAGE_NAMES['3.샘플 중국도착 대기(C)']).toBe('샘플 구매 완료')
    expect(DAOU_WORKS_SUGGESTED_SAAS_STAGE_NAMES['7.사방넷 제품등록(SCM팀)']).toBe('사방넷 상품등록')
    expect(DAOU_WORKS_SUGGESTED_SAAS_STAGE_NAMES['999-1. 샘플 판매요청']).toBe('진행불가')
    expect(DAOU_WORKS_SUGGESTED_SAAS_STAGE_NAMES['999-2. 샘플 판매완료']).toBe('진행불가')
  })
})
