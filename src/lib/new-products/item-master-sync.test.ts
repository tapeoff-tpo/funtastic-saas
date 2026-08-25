import { describe, expect, it } from 'vitest'
import {
  buildNewProductItemMasterData,
  shouldSyncNewProductToItemMaster,
  type NewProductItemMasterValues,
} from './item-master-sync'

const values: NewProductItemMasterValues = {
  productName: '테스트 상품',
  registeredProductName: '등록 상품명',
  englishName: 'Test product',
  sourceUrl: 'https://example.com/item',
  productOption: '핑크',
  sabangnetCode: '123456-0001',
  purchaseReferenceNotes: 'MOQ 300개',
  chinaUnitPriceCny: 12.5,
  calculatedCostKrw: 3500,
  previousCostKrw: 3300,
  exchangeRateKrw: 205.5,
  b2bOptionSurcharge: 500,
  b2cOptionSurcharge: 1000,
  b2bPrice: 7000,
  b2cPrice: 9900,
  noticeMaterial: '폴리우레탄',
  noticeSize: '5.5 × 5.5cm',
  noticeManufacturer: 'Yiwu Qingji Biotechnology Co., Ltd.',
  noticeWeight: '20g',
  noticeCountry: '중국',
  noticeCapacity: null,
  noticeFoodSafety: '대상 여부 확인 완료',
  noticeComponents: '본품, 케이스',
  noticeSpecialNotes: '화기 주의',
}

describe('new-product item-master synchronization', () => {
  it('starts at stage 5 and excludes stopped stages', () => {
    expect(shouldSyncNewProductToItemMaster({ position: 4, name: '사방넷 상품등록' })).toBe(false)
    expect(shouldSyncNewProductToItemMaster({ position: 5, name: '상품정보고시 제작' })).toBe(true)
    expect(shouldSyncNewProductToItemMaster({ position: 6, name: '샘플 미팅', itemMasterStartPosition: 7 })).toBe(false)
    expect(shouldSyncNewProductToItemMaster({ position: 7, name: '상품정보고시 제작', itemMasterStartPosition: 7 })).toBe(true)
    expect(shouldSyncNewProductToItemMaster({ position: 14, name: '진행불가' })).toBe(false)
    expect(shouldSyncNewProductToItemMaster({ position: 15, name: '진행보류' })).toBe(false)
  })

  it('maps the registration and product-notice fields to item metadata', () => {
    expect(buildNewProductItemMasterData(values)).toMatchObject({
      품목코드: '123456-0001',
      품목명: '등록 상품명',
      규격정보: '핑크',
      구매참고사항: 'MOQ 300개',
      '신규원가(元)': '12.5',
      'works 신규 원가': '3500',
      기준환율: '205.5',
      B2B옵션추가금: '500',
      재질: '폴리우레탄',
      제품크기: '5.5 × 5.5cm',
      '[식약처]유리/도자기제품 필수확인': '대상 여부 확인 완료',
      구성품: '본품, 케이스',
      특이사항: '화기 주의',
    })
    expect(buildNewProductItemMasterData(values)).not.toHaveProperty('용량')
  })
})
