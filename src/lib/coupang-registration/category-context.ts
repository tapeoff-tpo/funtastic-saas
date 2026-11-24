export type CategoryContext = {
  sourceCode: string
  productName: string
  categoryName: string
  categoryPath: string
  keywords: string[]
  queries: string[]
}

type SourceCategoryProduct = {
  code?: unknown
  name?: unknown
  category?: { name?: unknown; naverCategoryName?: unknown } | null
  tags?: unknown
}

const clean = (value: unknown, max = 200) => typeof value === 'string' ? value.normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, max) : ''
const unique = (values: string[]) => [...new Set(values.filter(Boolean))]

/** Search terms come from the source item, never a guessed Coupang category. */
export function buildCategoryContext(source: SourceCategoryProduct, sourceCode = String(source.code ?? '')): CategoryContext {
  const category = source.category && typeof source.category === 'object' ? source.category : null
  const categoryPath = clean(category?.naverCategoryName, 1000)
  const categoryName = clean(category?.name) || categoryPath.split('>').map((part) => part.trim()).filter(Boolean).at(-1) || ''
  const productName = clean(source.name, 500)
  const rawTags = typeof source.tags === 'string' ? source.tags.split(/[,\n]/) : Array.isArray(source.tags) ? source.tags : []
  const keywords = unique(rawTags.map((tag) => clean(tag)).filter((tag) => tag.length >= 2)).slice(0, 30)
  const shorterKeywords = keywords.flatMap((keyword) => {
    const end = keyword.indexOf('걸이') + 2
    return end > 2 && end < keyword.length ? [keyword.slice(0, end)] : []
  })
  return {
    sourceCode,
    productName,
    categoryName,
    categoryPath,
    keywords,
    queries: unique([categoryName, productName, ...shorterKeywords, ...keywords].map((value) => clean(value))).slice(0, 6),
  }
}

export async function getCategoryContext(code: string): Promise<CategoryContext> {
  if (!/^\d{1,100}$/.test(code)) throw new Error('B2B 상품 코드를 확인해주세요.')
  const response = await fetch(`https://funtasticb2b.com/api/products/by-code?${new URLSearchParams({ code })}`, {
    cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`B2B 상품 분류를 가져오지 못했습니다. (${response.status})`)
  const source: unknown = await response.json()
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('B2B 상품 분류 응답을 확인하지 못했습니다.')
  const product = source as SourceCategoryProduct
  if (!clean(product.name, 500) || String(product.code ?? '') !== code) throw new Error('B2B 상품 코드와 분류 응답이 일치하지 않습니다.')
  return buildCategoryContext(product, code)
}
