import {describe,it,expect} from 'vitest'
import {matchWorksIdentity} from './works-sync'
const item=(id:string,name='상품',url:string|null='https://source/1',sourceId:string|null=null)=>({id,product_name:name,source_url:url,daou_works_id:sourceId,sample_code:null})
describe('WORKS product identity',()=>{
 it('prefers exact string source IDs over names',()=>{
  expect(matchWorksIdentity([item('a'),item('b','다른 이름',null,'1547880477451386880')],'1547880477451386880','상품','https://source/1').match?.id).toBe('b')
 })
 it('links only one unlinked exact name and nonempty source URL',()=>{
  expect(matchWorksIdentity([item('a'),item('b','상품','https://source/2','old')],'new','상품','https://source/1').match?.id).toBe('a')
  expect(matchWorksIdentity([item('a')],'new','상품',null).reason).toBeDefined()
  expect(matchWorksIdentity([item('a'),item('b')],'new','상품','https://source/1').reason).toBeDefined()
  expect(matchWorksIdentity([item('a')],'new','상품','https://different').reason).toBeDefined()
 })
 it('does not repoint an existing source link',()=>{
  expect(matchWorksIdentity([item('a','상품','https://source/1','existing')],'new','상품','https://source/1').reason).toBeDefined()
 })
})
