import { beforeEach, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
const execute=vi.hoisted(()=>vi.fn())
vi.mock('@/lib/db',()=>({db:{execute}}))
import { deleteInboundMemo, inboundSearchText, listInboundPosts, publishInboundPost, updateInboundDates } from './inbound-board-store'
import type { ImportDocumentDetail } from './china-import-document'
const detail:ImportDocumentDetail={shipment:{shipmentNo:'CN',status:'packing',originWarehouseCode:'중국',destinationName:'인천',plannedOutboundDate:null,createdAt:'2026-11-25'},items:[{id:'a',sku:'100-0001',productName:'흰색 컵',optionName:'대',location:'A-01',warehouseCode:'중국',packedQuantity:3,reservedQuantity:3},{id:'unused',sku:'UNUSED',productName:'미포장',optionName:null,warehouseCode:'중국',packedQuantity:0,reservedQuantity:0}],pallets:[],boxes:[],boxItems:[{id:'line',boxId:'b',shipmentItemId:'a',quantity:3}]}
const dialect=new PgDialect()
beforeEach(()=>execute.mockReset())
it('searches text for allocated products, exact options and locations',()=>{
 const text=inboundSearchText(detail,'입고','위해')
 expect(text).toContain('100-0001');expect(text).toContain('흰색 컵');expect(text).toContain('a-01');expect(text).not.toContain('unused')
})
it('does not create tables just to read an empty board',async()=>{
 execute.mockResolvedValue([{exists:false}]);expect(await listInboundPosts('owner','컵')).toEqual([]);expect(execute).toHaveBeenCalledTimes(1)
})
it('uses parameterized literal search terms and workspace scope',async()=>{
 execute.mockResolvedValueOnce([{exists:true}]).mockResolvedValueOnce([])
 await listInboundPosts('owner','컵 100%')
 const query=dialect.sqlToQuery(execute.mock.calls[1][0]);expect(query.sql).toContain('user_id=');expect(query.sql).toContain('position(');expect(query.params).toEqual(['owner','컵','100%'])
})
it('never replaces an existing published shipment snapshot',async()=>{
 execute.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([{id:'existing'}])
 const result=await publishInboundPost({userId:'owner',actorId:'staff',shipmentId:'shipment',title:'입고',expectedDate:'2026-11-25',receivedDate:null,note:'',detail})
 expect(result).toMatchObject({created:false,post:{id:'existing'}})
 const insert=execute.mock.calls.map(([query])=>dialect.sqlToQuery(query)).find(query=>query.sql.includes('INSERT INTO'))!
 expect(insert.sql).toContain('ON CONFLICT (user_id,shipment_id) DO NOTHING')
 expect(insert.params).toContain('owner')
})
it('only changes dates with the matching workspace and revision',async()=>{
 execute.mockResolvedValueOnce([{exists:true}]).mockResolvedValueOnce([])
 expect(await updateInboundDates({userId:'owner',actorId:'staff',id:'post',revision:2,expectedDate:'2026-11-26',receivedDate:null})).toBeNull()
 const query=dialect.sqlToQuery(execute.mock.calls[1][0]);expect(query.sql).toContain('revision=');expect(query.sql).not.toContain('detail=');expect(query.params).toContain('owner');expect(query.params).toContain(2)
})

it('scopes memo deletion to the workspace, revision and authorized author', async () => {
  execute.mockResolvedValueOnce([{ exists: true }]).mockResolvedValueOnce([])
  expect(await deleteInboundMemo({ userId: 'owner', actorId: 'staff', id: 'post', revision: 3, isAdmin: false })).toBeNull()
  const query = dialect.sqlToQuery(execute.mock.calls[1][0])
  expect(query.sql).toContain("detail-'freightKrw'-'memoAuthor'")
  expect(query.sql).toContain("detail->'memoAuthor'->>'actorId'")
  expect(query.params).toEqual(expect.arrayContaining(['owner', 'staff', 'post', 3, false]))
})
