import { describe, expect, it } from 'vitest'
import { matchCategorySheet, type SavedSheetMapping } from '@/lib/coupang-registration/sheet-matching'
import type { CategoryContext } from '@/lib/coupang-registration/category-context'
import type { TemplateInfo } from '@/lib/coupang-registration/model'

const context = (categoryName: string, categoryPath = `가구/인테리어 > 수납가구 > ${categoryName}`, extra: Partial<CategoryContext> = {}): CategoryContext => ({
  sourceCode: '938', productName: '상품 이름', categoryName, categoryPath, keywords: [], queries: [], ...extra,
})
const template = (id: string, names: Array<string | [string, string[]]>): TemplateInfo => ({ id, name: `${id}.xlsx`, sheets: names.map(value => ({
  name: typeof value === 'string' ? value : value[0],
  columns: typeof value === 'string' ? [] : [{ column: 1, label: '카테고리', requirement: '필수', guide: '', choices: value[1] }],
})) })
const shelf = 'QF_2379_가구_수납가구_선반'
const coat = 'QF_202_생활용품_옷걸이'
const pants = 'QF_203_생활용품_바지걸이'
const mapping = (extra: Partial<SavedSheetMapping> = {}): SavedSheetMapping => ({ sourceCode: '938', sourceCategoryName: '선반', sourceCategoryPath: '가구/인테리어 > 수납가구 > 선반', targetSheetName: shelf, ...extra })

describe('official worksheet matching from the registered Funtastic category', () => {
  it('matches a precise category leaf and ignores misleading product titles and tags', () => {
    const source = context('선반', undefined, { productName: '옷걸이처럼 쓰는 정리대', keywords: ['바지걸이'], queries: ['옷걸이'] })
    expect(matchCategorySheet(source, [template('file', [coat, shelf, pants])])).toMatchObject({ status: 'matched', matched: { templateId: 'file', sheetName: shelf } })
  })

  it('does not turn a pants hanger into a coat or furniture hanger from a shared word', () => {
    const source = context('바지걸이', '생활/건강 > 생활용품 > 바지걸이', { productName: '바뜨 옷장 레일행거', keywords: ['옷걸이', '행거', '걸이'] })
    expect(matchCategorySheet(source, [template('wrong', [coat, 'QF_204_가구_수납가구_행거'])])).toMatchObject({ status: 'unmatched', candidates: [] })
    expect(matchCategorySheet(source, [template('correct', [coat, pants])]).matched?.sheetName).toBe(pants)
  })

  it('uses exact category leaves from the official validation choices', () => {
    const parentSheet = 'QF_10_생활용품_옷걸이-바지걸이'
    const result = matchCategorySheet(context('바지걸이', '생활용품 > 옷걸이 > 바지걸이'), [template('file', [[parentSheet, ['생활용품>옷걸이>옷걸이 (11)', '생활용품>옷걸이>바지걸이 (12)']]])])
    expect(result).toMatchObject({ status: 'matched', matched: { sheetName: parentSheet } })
  })

  it('requires a manual choice for an ancestor-only source category even if just one file is uploaded', () => {
    expect(matchCategorySheet(context('수납가구', '가구 > 수납가구'), [template('file', [shelf])])).toMatchObject({ status: 'ambiguous', candidates: [{ sheetName: shelf }] })
    expect(matchCategorySheet(context('수납가구', '가구 > 수납가구'), [template('file', [shelf, 'QF_33_가구_수납가구_서랍장'])]).candidates).toHaveLength(2)
    expect(matchCategorySheet(context('걸이', ''), [template('file', ['QF_9_걸이'])]).status).toBe('ambiguous')
  })

  it('uses shared authoritative ancestry to distinguish sheets with the same leaf label', () => {
    const kitchen = 'QF_99_주방용품_선반'
    expect(matchCategorySheet(context('선반'), [template('file', [kitchen, shelf])])).toMatchObject({ status: 'matched', matched: { sheetName: shelf } })
    expect(matchCategorySheet(context('선반', ''), [template('file', [kitchen, shelf])]).status).toBe('ambiguous')
  })

  it('does not resolve conflicting registered category name and path by guessing', () => {
    const result = matchCategorySheet(context('행거', '생활용품 > 바지걸이'), [template('file', ['QF_7_가구_행거', pants])])
    expect(result.status).toBe('ambiguous')
    expect(result.candidates).toHaveLength(2)
    expect(result.matched).toBeUndefined()
  })

  it('reuses a manually saved product connection across new workbook hashes and stable QF identifiers', () => {
    const renamed = 'QF_2379_가구_수납가구_선반-정리대'
    const result = matchCategorySheet(context('선반'), [template('new-hash', [renamed])], mapping())
    expect(result).toMatchObject({ status: 'matched', matched: { templateId: 'new-hash', sheetName: renamed }, reason: expect.stringContaining('저장한') })
  })

  it('requires review when a saved target is absent or the registered source classification changed', () => {
    expect(matchCategorySheet(context('선반'), [template('other', [coat])], mapping())).toMatchObject({ status: 'unmatched', reason: expect.stringContaining('없습니다') })
    const changed = matchCategorySheet(context('바지걸이', '생활용품 > 바지걸이'), [template('file', [shelf, pants])], mapping())
    expect(changed).toMatchObject({ status: 'ambiguous', reason: expect.stringContaining('달라') })
    expect(changed.matched).toBeUndefined()
  })

  it('keeps different workbook versions ambiguous but deduplicates an identical file and sheet', () => {
    const first = template('first-hash', [shelf])
    expect(matchCategorySheet(context('선반'), [first, template('second-hash', [shelf])]).status).toBe('ambiguous')
    expect(matchCategorySheet(context('선반'), [first, template('second-hash', [shelf])], mapping()).status).toBe('ambiguous')
    expect(matchCategorySheet(context('선반'), [first, first], mapping())).toMatchObject({ status: 'matched', candidates: [{ templateId: first.id }] })
  })

  it('does not borrow another product mapping and never uses titles when category metadata is absent', () => {
    expect(matchCategorySheet(context('바지걸이', '생활용품 > 바지걸이'), [template('file', [pants])], mapping({ sourceCode: '111' }))).toMatchObject({ status: 'matched', matched: { sheetName: pants } })
    expect(matchCategorySheet(context('', '', { productName: '선반', keywords: ['선반'] }), [template('file', [shelf])])).toMatchObject({ status: 'unmatched', candidates: [] })
    expect(matchCategorySheet(context('선반', undefined, { sourceCode: '' }), [template('file', [shelf])], mapping())).toMatchObject({ status: 'unmatched', candidates: [] })
  })

  it('accepts harmless source spelling normalization and preserves all input records', () => {
    const source = context(' 선 반 ', '가구/인테리어  >  수납가구 > 선반')
    const templates = [template('file', [shelf])]
    const saved = mapping()
    const before = JSON.stringify({ source, templates, saved })
    expect(matchCategorySheet(source, templates, saved).status).toBe('matched')
    expect(JSON.stringify({ source, templates, saved })).toBe(before)
  })
})
