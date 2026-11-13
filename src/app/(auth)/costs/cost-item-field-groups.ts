export type CostItemFieldGroup = {
  id: string
  title: string
  headers: string[]
  initiallyOpen: boolean
}

const FIELD_GROUPS = [
  {
    id: 'basic',
    title: '기본정보',
    initiallyOpen: true,
    headers: ['품목코드', '품목명', '중국어 상품명', '영문명', '규격정보', '품목구분'],
  },
  {
    id: 'costs',
    title: '원가·구매',
    initiallyOpen: true,
    headers: ['특가(元)', '신규원가(元)', '상품원가(元)', '배송비(元)', 'works 기존 원가', 'works 신규 원가', '기준환율', '구매 URL', '구매참고사항'],
  },
  {
    id: 'specifications',
    title: '상품규격·구성',
    initiallyOpen: false,
    headers: ['재질', '제품크기', '무게', '용량', '구성품', '제조사', '제조국'],
  },
  {
    id: 'compliance',
    title: '통관·인증',
    initiallyOpen: false,
    headers: ['HS CODE', '검역대상 여부', '100KG 인증여부', '[식약처]유리/도자기제품 필수확인'],
  },
  {
    id: 'warehouse',
    title: '창고·메모',
    initiallyOpen: false,
    headers: ['한국창고기준 위치', '특이사항'],
  },
  {
    id: 'tax',
    title: '세금·판매추가금',
    initiallyOpen: false,
    headers: ['매입부가세', '보통영수증 (%)', '증취세영수증  (%)', 'B2B옵션추가금', 'B2C옵션추가금'],
  },
] as const

/** Keep every supplied field once, including future headers not yet classified. */
export function groupCostItemFields(headers: readonly string[]): CostItemFieldGroup[] {
  const available = new Set(headers)
  const assigned = new Set<string>()
  const groups: CostItemFieldGroup[] = []

  for (const definition of FIELD_GROUPS) {
    const groupedHeaders = definition.headers.filter((header) => available.has(header) && !assigned.has(header))
    if (groupedHeaders.length === 0) continue
    for (const header of groupedHeaders) assigned.add(header)
    groups.push({ ...definition, headers: groupedHeaders })
  }

  const otherHeaders = [...available].filter((header) => !assigned.has(header))
  if (otherHeaders.length > 0) {
    groups.push({ id: 'other', title: '기타 정보', headers: otherHeaders, initiallyOpen: false })
  }

  return groups
}
