// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ user:vi.fn(), access:vi.fn(), owner:vi.fn(), list:vi.fn(), get:vi.fn(), publish:vi.fn(), update:vi.fn(), detail:vi.fn(), locations:vi.fn(), excel:vi.fn(), preview:vi.fn() }))
vi.mock('@/lib/auth/current-user',()=>({getCurrentUser:m.user}))
vi.mock('@/lib/auth/menu-access',()=>({getUserMenuAccess:m.access}))
vi.mock('@/lib/admin-accounts/queries',()=>({getWorkspaceUserId:m.owner}))
vi.mock('@/lib/purchasing/inbound-board-store',()=>({listInboundPosts:m.list,getInboundPost:m.get,publishInboundPost:m.publish,updateInboundDates:m.update}))
vi.mock('@/lib/purchasing/saas-china-outbound',()=>({getChinaOutboundShipmentDetail:m.detail}))
vi.mock('@/lib/purchasing/items',()=>({getPurchasingItemLocationsBySku:m.locations}))
vi.mock('@/lib/purchasing/korea-shipping-document',()=>({exportKoreaShippingDocument:m.excel}))
vi.mock('@/lib/purchasing/china-import-preview',()=>({renderChinaImportPreview:m.preview}))
const notices = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }))
vi.mock('@/lib/purchasing/board-notices', () => ({ readBoardNotices: notices.read, writeBoardNotice: notices.write }))
import { GET, POST, PATCH } from './route'
const id='11111111-1111-4111-8111-111111111111'
const req=(body:unknown,method='POST')=>new Request('http://localhost/api/purchasing/inbound-board',{method,body:JSON.stringify(body)})
beforeEach(()=>{vi.clearAllMocks();m.user.mockResolvedValue({id:'staff'});m.access.mockResolvedValue({allowedMenus:['/purchasing/import-documents'],superAdmin:false});m.owner.mockResolvedValue('owner');m.list.mockResolvedValue([])})
it('requires authentication and menu access before reading or publishing',async()=>{
 m.user.mockResolvedValue(null);expect((await GET(new Request('http://localhost'))).status).toBe(401);expect(m.list).not.toHaveBeenCalled()
 m.user.mockResolvedValue({id:'staff'});m.access.mockResolvedValue({allowedMenus:[],superAdmin:false});expect((await POST(req({}))).status).toBe(403);expect(m.detail).not.toHaveBeenCalled()
})
it('searches within the shared workspace',async()=>{
 expect((await GET(new Request('http://localhost?q=컵%20흰색'))).status).toBe(200)
 expect(m.list).toHaveBeenCalledWith('owner','컵 흰색')
})
it('publishes a server-resolved snapshot and preserves duplicate posts',async()=>{
 const detail={shipment:{shipmentNo:'CN-1'},items:[{id:'a',sku:'SKU',location:''}],boxes:[],pallets:[],boxItems:[{shipmentItemId:'a',quantity:3}]}
 m.detail.mockResolvedValue(detail);m.locations.mockResolvedValue(new Map([['SKU','A-01']]))
 m.publish.mockResolvedValue({post:{id},created:true})
 const body={shipmentId:id,title:'입고',expectedDate:'2026-11-25',receivedDate:null,note:'위해'}
 expect((await POST(req(body))).status).toBe(201)
 expect(m.detail).toHaveBeenCalledWith({userId:'owner',shipmentId:id})
 expect(m.publish).toHaveBeenCalledWith(expect.objectContaining({userId:'owner',actorId:'staff',detail:expect.objectContaining({items:[expect.objectContaining({location:'A-01'})]})}))
 m.publish.mockResolvedValue({post:{id},created:false})
 expect((await (await POST(req(body))).json()).created).toBe(false)
})
it('rejects invalid dates and protects concurrent date edits',async()=>{
 expect((await PATCH(req({id,revision:1,expectedDate:'2026-02-30',receivedDate:null},'PATCH'))).status).toBe(400)
 m.update.mockResolvedValue(null)
 expect((await PATCH(req({id,revision:1,expectedDate:'2026-11-25',receivedDate:null},'PATCH'))).status).toBe(409)
 expect(m.update).toHaveBeenCalledWith(expect.objectContaining({userId:'owner',actorId:'staff',revision:1}))
})
it('prints and downloads the saved snapshot, not current shipment data',async()=>{
 const detail={shipment:{shipmentNo:'snapshot'}};m.get.mockResolvedValue({id,title:'입고',detail});m.excel.mockResolvedValue(Buffer.from('xlsx'));m.preview.mockResolvedValue('<table>saved</table>')
 const response=await GET(new Request(`http://localhost?id=${id}&group=pallet&format=print`))
 expect(await response.text()).toContain('saved');expect(m.excel).toHaveBeenCalledWith(detail,'box',expect.stringContaining('입고'),true);expect(m.detail).not.toHaveBeenCalled()
 expect((await GET(new Request(`http://localhost?id=${id}&format=excel`))).headers.get('content-type')).toContain('spreadsheetml')
})


it('publishes a stockout attachment in the shared workspace and serves it as a download', async () => {
  notices.write.mockResolvedValue(id)
  const form = new FormData()
  form.set('category', 'sold-out')
  form.set('title', '품절리스트')
  form.set('body', '')
  form.set('attachment', new File(['SKU,상태'], 'stock.csv'))
  expect((await POST(new Request('http://localhost', { method: 'POST', body: form }))).status).toBe(201)
  expect(notices.write).toHaveBeenCalledWith(expect.objectContaining({ owner: 'owner', actor: 'staff', category: 'sold-out', filename: 'stock.csv' }))
  notices.read.mockResolvedValue({ attachment: { filename: 'stock.csv', attachment: Buffer.from('SKU,상태').toString('base64') } })
  const response = await GET(new Request('http://localhost?category=sold-out&attachment=' + id))
  expect(notices.read).toHaveBeenCalledWith('owner', 'sold-out', '', id)
  expect(response.headers.get('content-disposition')).toContain('attachment;')
  expect(await response.text()).toBe('SKU,상태')
})
