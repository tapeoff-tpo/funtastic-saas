import { describe, expect, it } from 'vitest'
import { applyProductMasterDefaults, applyRegistrationDefaults, createRegistrationRow, PACKAGING_SIZE_FIELD, PACKAGING_WEIGHT_FIELD, registrationCommonSheet, registrationFieldKey, registrationFieldValue, type RegistrationProductMaster, type RegistrationRow, type TemplateSheet } from '@/lib/coupang-registration/model'
import { rowSchema } from '@/lib/coupang-registration/schema'

const master: RegistrationProductMaster = {
  itemId: 'product-management-item', match: 'sku', noticeSize: '25 × 12 × 41 (cm)', noticeWeight: '400g',
  noticeMaterial: '철제 / 원목', noticeManufacturer: '확인된 제조공장', noticeCountry: '중국',
  noticeComponents: '본체 1개, 조립 나사 4개', noticeCapacity: '2L',
}
const row = (overrides: Partial<RegistrationRow> = {}): RegistrationRow => ({ ...createRegistrationRow(), name: '피에른 선반 브라운', sourceName: '피에른 선반', productMaster: master, ...overrides })

describe('known original notice data', () => {
  it('prefills original notice values separately from the packaging dimensions before a file is connected', () => {
    const result = applyProductMasterDefaults(row())
    expect(result.fields).toMatchObject({
      품명: '피에른 선반', '주요 소재': '철제 / 원목', 크기: '25 × 12 × 41 (cm)', 구성품: '본체 1개, 조립 나사 4개', 용량: '2L',
      [PACKAGING_SIZE_FIELD]: '270*140*430', [PACKAGING_WEIGHT_FIELD]: '400',
    })
    expect(result.defaultedFields).toEqual(result.fields)
    expect(applyProductMasterDefaults(result)).toBe(result)
  })

  it('preserves manual values and deliberate clears while refreshing unedited original defaults', () => {
    const initial = applyProductMasterDefaults(row())
    const edited = { ...initial, fields: { ...initial.fields, 품명: '직접 입력 품명', 크기: '직접 확인 크기', 구성품: '', 용량: '' } }
    const result = applyProductMasterDefaults({ ...edited, productMaster: { ...master, noticeMaterial: '알루미늄', noticeSize: '30*20*50cm', noticeComponents: '바뀐 구성품', noticeCapacity: '3L' } })
    expect(result.fields).toMatchObject({ 품명: '직접 입력 품명', 크기: '직접 확인 크기', 구성품: '', 용량: '', '주요 소재': '알루미늄', [PACKAGING_SIZE_FIELD]: '320*220*520' })
    const imported = row({ fields: { 품명: '엑셀 품명', '주요 소재': '엑셀 재질', 크기: '엑셀 크기', 구성품: '엑셀 구성품', 용량: '엑셀 용량' } })
    const preserved = applyProductMasterDefaults(imported)
    for (const [key, value] of Object.entries(imported.fields)) expect(preserved.fields[key]).toBe(value)
  })

  it('only adds original defaults to matching editable official columns and preserves scoped clears', () => {
    const sheet: TemplateSheet = { name: 'QF_1_가구', columns: [
      { column: 1, label: '주요 소재', requirement: '필수', guide: '' },
      { column: 2, label: '주요 소재', requirement: '필수', guide: '' },
      { column: 3, label: '크기', requirement: '필수', guide: '' },
    ] }
    const initial = row({ templateId: 'official-file' })
    const firstKey = registrationFieldKey(initial, sheet, sheet.columns[0])
    const result = applyRegistrationDefaults({ ...initial, fields: { [firstKey]: '' } }, sheet)
    expect(result.fields).toEqual({ [firstKey]: '', [registrationFieldKey(initial, sheet, sheet.columns[1])]: master.noticeMaterial, 크기: master.noticeSize })
    expect(registrationFieldValue(result, sheet, sheet.columns[0])).toBe('')
    expect(result.fields).not.toHaveProperty('구성품')
  })

  it('offers agreed common values without treating them as official requirements or guessing certifications', () => {
    const result = applyRegistrationDefaults(row(), registrationCommonSheet)
    expect(result.fields).toMatchObject({ 브랜드: '생활살림', '상품 바코드': '바코드 없음(쿠팡 바코드 생성 요청)', 수입자: '테이포프주식회사', '박스 내 SKU 수량': '20', 크기: master.noticeSize, 구성품: master.noticeComponents })
    expect(registrationCommonSheet.columns.every(column => column.requirement === '공통정보')).toBe(true)
    for (const name of ['인증정보', 'KC 인증정보', '과세여부', '출시 연도', 'A/S 책임자와 전화번호']) expect(result.fields).not.toHaveProperty(name)
    expect(applyRegistrationDefaults(row({ productMaster: { ...master, noticeSize: '50*30*30cm' } }), registrationCommonSheet).fields['박스 내 SKU 수량']).toBe('1')
  })

  it('does not use one component master as the contents, material or measurements of a bundle', () => {
    const bundle = row({ name: '선반과 수납함 세트', bundleComponents: [] })
    expect(applyProductMasterDefaults(bundle).fields).toEqual({ 품명: '선반과 수납함 세트' })
    const result = applyRegistrationDefaults(bundle, registrationCommonSheet)
    expect(result.fields).toMatchObject({ 품명: '선반과 수납함 세트', 브랜드: '생활살림' })
    for (const name of ['주요 소재', '크기', '구성품', '용량', PACKAGING_SIZE_FIELD, PACKAGING_WEIGHT_FIELD]) expect(result.fields).not.toHaveProperty(name)
  })

  it.each(['queued', 'running', 'login_required', 'succeeded'] as const)('keeps %s submission data unchanged in both default paths', status => {
    const locked = row({ submission: { status, jobId: 'job-1' } })
    expect(applyProductMasterDefaults(locked)).toBe(locked)
    expect(applyRegistrationDefaults(locked, registrationCommonSheet)).toBe(locked)
  })

  it('keeps registered rows unchanged and accepts old saved masters without the new optional notice fields', () => {
    const registered = row({ stage: 'registered' })
    expect(applyProductMasterDefaults(registered)).toBe(registered)
    const legacyMaster = { ...master }
    delete legacyMaster.noticeComponents
    delete legacyMaster.noticeCapacity
    const legacy = row({ productMaster: legacyMaster })
    const parsed = rowSchema.parse(legacy)
    expect(parsed.productMaster).toEqual(legacyMaster)
    expect(rowSchema.parse(row()).productMaster).toEqual(master)
    const result = applyProductMasterDefaults(parsed)
    expect(result.fields).not.toHaveProperty('구성품')
    expect(result.fields).not.toHaveProperty('용량')
  })
})
