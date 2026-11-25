import type { CategoryContext } from './category-context'
import type { TemplateInfo } from './model'

export type SheetMatchCandidate = { templateId: string; sheetName: string; label: string }
export type SavedSheetMapping = {
  sourceCode: string
  sourceCategoryName: string
  sourceCategoryPath: string
  targetSheetName: string
}
export type SheetMatchResult = {
  status: 'matched' | 'ambiguous' | 'unmatched'
  reason: string
  candidates: SheetMatchCandidate[]
  matched?: SheetMatchCandidate
}

type DescribedCandidate = SheetMatchCandidate & { paths: string[][]; leaves: Set<string>; terms: Set<string> }
const genericCategories = new Set(['전체', '미분류', '기타', '용품', '기타용품', '생활', '생활용품', '생활잡화', '기타생활용품', '잡화', '가구', '수납가구', '수납', '정리용품', '걸이'])
const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase('ko-KR').replace(/[^\p{L}\p{N}]/gu, '')
const pathParts = (value: string) => value.normalize('NFKC').replace(/\s*\(\s*\d+\s*\)\s*$/, '').split(/\s*(?:>|→|›|»)\s*/u).map(normalize).filter(Boolean)
const sheetId = (name: string) => /^QF_(\d+)(?:_|$)/.exec(name)?.[1]
const publicCandidate = ({ templateId, sheetName, label }: SheetMatchCandidate): SheetMatchCandidate => ({ templateId, sheetName, label })

function describeTemplates(templates: readonly TemplateInfo[]): DescribedCandidate[] {
  const candidates = new Map<string, DescribedCandidate>()
  for (const template of templates) {
    for (const sheet of template.sheets) {
      const key = JSON.stringify([template.id, sheet.name])
      if (candidates.has(key)) continue
      const label = sheet.name.replace(/^QF_\d+_/, '')
      const paths = [label.split('_').map(normalize).filter(Boolean), ...sheet.columns
        .filter(column => normalize(column.label) === '카테고리')
        .flatMap(column => column.choices ?? [])
        .map(pathParts)]
        .filter(parts => parts.length > 0)
      candidates.set(key, {
        templateId: template.id, sheetName: sheet.name, label, paths,
        leaves: new Set(paths.flatMap(parts => parts.at(-1) ? [parts.at(-1)!] : [])),
        terms: new Set(paths.flat()),
      })
    }
  }
  return [...candidates.values()]
}

function matchSourceCategory(context: CategoryContext, candidates: DescribedCandidate[]): SheetMatchResult {
  const sourcePath = pathParts(context.categoryPath)
  const sourceLeaf = sourcePath.at(-1) ?? ''
  const sourceName = normalize(context.categoryName)
  const anchors = [...new Set([sourceName, sourceLeaf].filter(Boolean))]
  if (!anchors.length) return { status: 'unmatched', reason: '펀타스틱 카테고리가 없어 시트를 선택해야 합니다.', candidates: [] }

  // Product names/tags are deliberately excluded: a word such as 걸이 cannot
  // turn a pants hanger into a coat rack or a furniture hanger worksheet.
  const specific = anchors.filter(anchor => !genericCategories.has(anchor))
  const strong = candidates.filter(candidate => specific.some(anchor => candidate.leaves.has(anchor)))
  if (strong.length) {
    const named = strong.filter(candidate => !!sourceName && candidate.leaves.has(sourceName))
    const pathNamed = strong.filter(candidate => !!sourceLeaf && candidate.leaves.has(sourceLeaf))
    if (sourceName && sourceLeaf && sourceName !== sourceLeaf && named.length && pathNamed.length
      && new Set([...named, ...pathNamed]).size > 1) {
      return { status: 'ambiguous', reason: '펀타스틱 분류명과 분류 경로가 서로 다른 시트에 해당합니다.', candidates: strong.map(publicCandidate) }
    }
    const ancestors = new Set(sourcePath.slice(0, -1))
    const ranked = strong.map(candidate => ({ candidate, overlap: Math.max(0, ...candidate.paths.map(parts => new Set(parts.slice(0, -1).filter(part => ancestors.has(part))).size)) }))
    const bestOverlap = Math.max(...ranked.map(item => item.overlap))
    const best = ranked.filter(item => item.overlap === bestOverlap).map(item => item.candidate)
    if (best.length === 1) {
      const matched = publicCandidate(best[0])
      return { status: 'matched', reason: '펀타스틱 카테고리와 일치하는 시트입니다.', candidates: [matched], matched }
    }
    return { status: 'ambiguous', reason: '펀타스틱 카테고리에 해당하는 시트가 여러 개입니다.', candidates: best.map(publicCandidate) }
  }

  const broad = candidates.filter(candidate => anchors.some(anchor => candidate.terms.has(anchor)))
  return broad.length
    ? { status: 'ambiguous', reason: '펀타스틱 분류가 넓어 상품에 맞는 시트를 선택해야 합니다.', candidates: broad.map(publicCandidate) }
    : { status: 'unmatched', reason: '펀타스틱 카테고리에 맞는 시트를 찾지 못했습니다.', candidates: [] }
}

/** Match only against uploaded official sheets; never infer a category from the title alone. */
export function matchCategorySheet(context: CategoryContext, templates: readonly TemplateInfo[], savedMapping?: SavedSheetMapping): SheetMatchResult {
  if (!/^\d{1,100}$/.test(context.sourceCode)) return { status: 'unmatched', reason: '펀타스틱 상품 코드가 없어 시트를 선택해야 합니다.', candidates: [] }
  const candidates = describeTemplates(templates)
  const categoryResult = matchSourceCategory(context, candidates)
  if (!savedMapping || savedMapping.sourceCode !== context.sourceCode) return categoryResult

  const sameCategory = normalize(savedMapping.sourceCategoryName) === normalize(context.categoryName)
    && JSON.stringify(pathParts(savedMapping.sourceCategoryPath)) === JSON.stringify(pathParts(context.categoryPath))
  if (!sameCategory) return {
    status: categoryResult.candidates.length ? 'ambiguous' : 'unmatched',
    reason: '펀타스틱 카테고리가 저장한 연결 당시와 달라 다시 선택해야 합니다.', candidates: categoryResult.candidates,
  }

  const targetId = sheetId(savedMapping.targetSheetName)
  const matches = candidates.filter(candidate => targetId ? sheetId(candidate.sheetName) === targetId : candidate.sheetName === savedMapping.targetSheetName)
  if (matches.length === 1) {
    const matched = publicCandidate(matches[0])
    return { status: 'matched', reason: '이 상품에 저장한 시트 연결을 불러왔습니다.', candidates: [matched], matched }
  }
  return matches.length
    ? { status: 'ambiguous', reason: '저장한 카테고리의 양식이 여러 파일에 있어 사용할 시트를 선택해야 합니다.', candidates: matches.map(publicCandidate) }
    : { status: 'unmatched', reason: '이 상품에 저장한 시트가 업로드한 엑셀에 없습니다.', candidates: categoryResult.candidates }
}
