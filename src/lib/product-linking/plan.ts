export type LinkTarget = 'item' | 'cost' | 'price' | 'registration'
type ProductNotice = { label: string; value: string }

export type LinkState = {
  source: {
    id: string
    product_name: string
    registered_product_name: string | null
    sabangnet_code: string | null
    product_option: string | null
    source_url: string | null
    english_name: string | null
    detail_page_url: string | null
    b2b_price: number | null
    b2c_price: number | null
    notice_material: string | null
    notice_size: string | null
    notice_country: string | null
    notice_manufacturer: string | null
    notice_weight: string | null
    notice_capacity: string | null
    notice_components: string | null
    notice_special_notes: string | null
    metadata: { linkedSync?: { item?: { code?: string } } } | null
  }
  item: {
    id: string
    name: string
    cost_price: string | null
    metadata: {
      esa009m?: Record<string, unknown>
      newProductWorkflow?: { itemId?: string }
      priceWorkflow?: { excluded?: boolean }
      [key: string]: unknown
    } | null
  } | null
  price: {
    id: string
    product_name: string | null
    option_name: string | null
    raw_data: Record<string, string>
  } | null
  registration: {
    source_price: string | null
    source_retail_price: string | null
    source_cost_price: string | null
    product_name: string | null
    manufacturer: string | null
    country_of_origin: string | null
    detail_notice: {
      linkedWorkflow?: { itemId?: string; detailPageUrl?: string }
      [key: string]: unknown
    } | null
    source_product_notice: ProductNotice[]
    source_options: Array<Record<string, unknown>>
  } | null
}
export type LinkChange = {
  key: string
  label: string
  before: unknown
  after: unknown
}
export const LINK_LABELS: Record<LinkTarget, string> = {
  item: '확정 상품정보 → 원가·품목',
  cost: '원가 → 판매가 테이블',
  price: '판매가 → 상품정보',
  registration: '작성 정보 → 상품등록',
}
export function amount(value: unknown): number | null {
  if (value == null || String(value).trim() === '') return null
  const n = Number(String(value).replaceAll(',', '').replace(/원$/, '').trim())
  return Number.isSafeInteger(n) && n >= 0 && n <= 2147483647 ? n : null
}
export function buildLinkChanges(
  state: LinkState,
  target: LinkTarget,
): LinkChange[] {
  const { source: s, item, price, registration: r } = state
  const code = String(s.sabangnet_code ?? '').trim()
  const name = String(s.registered_product_name || s.product_name || '').trim()
  if (!code)
    throw new Error('상품관리에서 사방넷코드(품목코드)를 먼저 입력해주세요.')
  if (!name) throw new Error('확정 상품명을 먼저 입력해주세요.')
  const changes: LinkChange[] = []
  function add(key: string, label: string, before: unknown, after: unknown) {
    if (after == null || after === '') return
    if (JSON.stringify(before ?? null) !== JSON.stringify(after))
      changes.push({ key, label, before: before ?? null, after })
  }
  if (target === 'item') {
    if (!s.registered_product_name?.trim())
      throw new Error('정식 상품명을 먼저 확정해주세요.')
    add(
      'workflowItem',
      '상품관리 연결',
      item?.metadata?.newProductWorkflow?.itemId,
      s.id,
    )
    add('name', '확정 상품명', item?.name, name)
    const fields: Record<string, string | null> = {
      품목코드: code,
      품목명: name,
      규격정보: s.product_option,
      '구매 URL': s.source_url,
      영문명: s.english_name,
      재질: s.notice_material,
      제품크기: s.notice_size,
      제조국: s.notice_country,
      제조사: s.notice_manufacturer,
    }
    for (const [key, value] of Object.entries(fields))
      add(`esa:${key}`, key, item?.metadata?.esa009m?.[key], value)
    // Calculated/sample estimates must never replace a landed item cost.
  } else if (target === 'cost') {
    if (!item)
      throw new Error('먼저 확정 상품정보를 원가·품목에 동기화해주세요.')
    const cost = amount(item.cost_price)
    if (cost == null || cost <= 0)
      throw new Error(
        '원가 메뉴에서 실제 원가를 입력한 뒤 동기화해주세요. 예상 원가는 가져오지 않습니다.',
      )
    add('productName', '확정 상품명', price?.product_name, name)
    add('optionName', '옵션명', price?.option_name, s.product_option)
    add(
      'raw:원가',
      '품목에 입력한 원가',
      price?.raw_data?.['원가'],
      String(cost),
    )
    add('raw:상품코드', '품목코드', price?.raw_data?.['상품코드'], code)
  } else if (target === 'price') {
    if (!price) throw new Error('판매가 테이블에 먼저 원가를 동기화해주세요.')
    const b2b = amount(price.raw_data?.['B2B 판매가']),
      b2c = amount(price.raw_data?.['B2C 판매가'])
    if (!(b2b && b2c) && !item?.metadata?.priceWorkflow?.excluded)
      throw new Error(
        'B2B·B2C 판매가를 입력하거나 입력 제외 사유를 지정해주세요.',
      )
    add('b2b_price', 'B2B 판매가', s.b2b_price, b2b)
    add('b2c_price', 'B2C 판매가', s.b2c_price, b2c)
  } else {
    if (!item) throw new Error('원가·품목 연결을 먼저 완료해주세요.')
    if (!(amount(price?.raw_data?.['원가']) ?? 0))
      throw new Error('실제 원가를 판매가 테이블에 먼저 동기화해주세요.')
    const b2b = amount(price?.raw_data?.['B2B 판매가']),
      b2c = amount(price?.raw_data?.['B2C 판매가'])
    if (!(b2b && b2c) && !item.metadata?.priceWorkflow?.excluded)
      throw new Error('판매가 테이블의 판매가 입력을 먼저 완료해주세요.')
    if (!s.detail_page_url)
      throw new Error('완료된 상세페이지 URL을 상품관리에 입력해주세요.')
    try {
      if (new URL(s.detail_page_url).protocol !== 'https:') throw Error()
    } catch {
      throw new Error('상세페이지 주소는 HTTPS 주소여야 합니다.')
    }
    add('product_name', '확정 상품명', r?.product_name, name)
    add(
      'source_cost_price',
      '원가',
      amount(r?.source_cost_price),
      amount(price?.raw_data?.['원가']),
    )
    add('source_price', 'B2B 판매가', amount(r?.source_price), b2b)
    add(
      'source_retail_price',
      'B2C 판매가',
      amount(r?.source_retail_price),
      b2c,
    )
    if (s.product_option?.trim() && !r?.source_options?.length) {
      add('source_options', '등록 옵션', r?.source_options, [
        {
          id: code,
          optionName: s.product_option,
          stockQty: 0,
          status: 'TEMP_OUT',
        },
      ])
    }
    add('manufacturer', '제조사', r?.manufacturer, s.notice_manufacturer)
    add('country_of_origin', '제조국', r?.country_of_origin, s.notice_country)
    add(
      'workflowItem',
      '상품관리 연결',
      r?.detail_notice?.linkedWorkflow?.itemId,
      s.id,
    )
    add(
      'detailPageUrl',
      '상세페이지 URL',
      r?.detail_notice?.linkedWorkflow?.detailPageUrl,
      s.detail_page_url,
    )
    const noticeFields: Array<[string, string | null]> = [
      ['재질', s.notice_material],
      ['제품크기', s.notice_size],
      ['제조사', s.notice_manufacturer],
      ['제조국', s.notice_country],
      ['무게', s.notice_weight],
      ['용량', s.notice_capacity],
      ['구성품', s.notice_components],
      ['특이사항', s.notice_special_notes],
    ]
    const notice = noticeFields.flatMap(([label, value]) =>
      value?.trim() ? [{ label, value }] : [],
    )
    if (notice.length) {
      const current = Array.isArray(r?.source_product_notice)
        ? r.source_product_notice
        : []
      const merged = new Map(current.map((entry) => [entry.label, entry]))
      for (const entry of notice) merged.set(entry.label, entry)
      add('source_product_notice', '상품정보고시', current, [
        ...merged.values(),
      ])
    }
  }
  return changes
}
