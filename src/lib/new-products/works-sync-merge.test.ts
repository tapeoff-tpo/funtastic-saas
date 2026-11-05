import { describe, it, expect } from 'vitest'
import { parseDaouWorksCsvText } from './daou-works-import'
import { mergeWorksProduct, stableJson, type SyncRow } from './works-sync-merge'
const parse=(price=100,capacity='500ml',options='화이트,S1,20')=>parseDaouWorksCsvText(`*ID,상태,제품명,B2B 판매가 (도매),용량 (C),용량 (C),옵션-옵션명,옵션-사방넷코드(옵션),옵션-원가(원화)\n123,15.등록완료,상품,${price},${capacity},,${options}`).items[0]
const stages={'15.등록완료':'done'}
const initial=(item= parse()):SyncRow=>({id:'i',daou_works_id:'123',product_name:'상품',b2b_price:100,notice_capacity:'500ml',stage_id:'done',metadata:{daouWorks:item.source,optionDetails:item.values.optionDetails}})
describe('safe WORKS merge',()=>{
 it('keeps the populated duplicate header and rejects conflicting duplicates',()=>{
  expect(parse().values.noticeCapacity).toBe('500ml')
  expect(()=>parseDaouWorksCsvText('*ID,상태,제품명,용량 (C),용량 (C)\n1,상태,상품,1,2')).toThrow()
 })
 it('retains master values populated on a later option row',()=>{
  const parsed=parseDaouWorksCsvText('*ID,상태,제품명,무게 (C),옵션-옵션명\n1,상태,상품,,A\n1,상태,상품,300g,B')
  expect(parsed.items[0].source.rawFields['무게 (C)']).toBe('300g')
 })
 it('updates unchanged source values, preserves local edits, and never mutates input',()=>{
  const row=initial();row.b2b_price=150
  const snapshot=stableJson(row)
  const merged=mergeWorksProduct(row,parse(200,'700ml'),stages)
  expect(merged.patch.b2b_price).toBeUndefined()
  expect(merged.patch.notice_capacity).toBe('700ml')
  expect(merged.conflicts).toContainEqual(expect.objectContaining({field:'b2bPrice',reason:'both_changed'}))
  expect(stableJson(row)).toBe(snapshot)
  const next={...row,...merged.patch,metadata:merged.metadata}
  expect(mergeWorksProduct(next,parse(200,'700ml'),stages).needsWrite).toBe(false)
 })
 it('preserves hidden legacy and custom option fields',()=>{
  const row=initial();const options=row.metadata!.optionDetails as Array<Record<string,unknown>>
  options[0].bulkSize='40×50×60';options[0].productSize='5cm';options[0].customSupplierNote='보존'
  const result=mergeWorksProduct(row,parse(200),stages)
  expect(result.metadata.optionDetails).toEqual(expect.arrayContaining([expect.objectContaining({bulkSize:'40×50×60',productSize:'5cm',customSupplierNote:'보존'})]))
 })
 it('preserves source clears and local clears',()=>{
  expect(mergeWorksProduct(initial(),parse(100,''),stages).patch.notice_capacity).toBeUndefined()
  const local=initial();local.notice_capacity=null
  expect(mergeWorksProduct(local,parse(100,'900ml'),stages).patch.notice_capacity).toBeUndefined()
 })
 it('updates options by SKU when reordered and keeps local costs',()=>{
  const old=parse();const row=initial(old)
  const opts=row.metadata!.optionDetails as Array<Record<string,unknown>>;opts[0].costKrw=99
  const next=parse(100,'500ml','블랙,S2,40\n123,15.등록완료,상품,100,500ml,,화이트,S1,30')
  const merged=mergeWorksProduct(row,next,stages)
  expect((merged.metadata.optionDetails as Array<Record<string,unknown>>).map(o=>[o.sabangnetOptionCode,o.costKrw])).toEqual([['S1',99],['S2',40]])
 })
 it('preserves a locally removed option and source-removed option',()=>{
  const row=initial();row.metadata!.optionDetails=[]
  const merged=mergeWorksProduct(row,parse(100,'500ml','화이트,S1,30'),stages)
  expect(merged.metadata.optionDetails).toEqual([])
  expect(merged.conflicts.some(c=>c.reason==='local_option_removed')).toBe(true)
  const removed=parse(100,'500ml','')
  expect(mergeWorksProduct(initial(),removed,stages).metadata.optionDetails).toHaveLength(1)
 })
 it('keeps manual stages and records unmapped statuses idempotently',()=>{
  const row=initial();row.stage_id='manual'
  expect(mergeWorksProduct(row,parse(),stages).patch.stage_id).toBeUndefined()
  const merged=mergeWorksProduct(initial(),parse(),{})
  expect(merged.conflicts[0].reason).toBe('unmapped_stage_preserved')
  expect(mergeWorksProduct({...initial(),metadata:merged.metadata},parse(),{}).needsWrite).toBe(false)
 })
})
