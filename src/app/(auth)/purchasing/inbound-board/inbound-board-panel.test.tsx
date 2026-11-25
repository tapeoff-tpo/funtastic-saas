import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { InboundBoardPanel, InboundBoardWorkspace } from './inbound-board-panel'
const entry={id:'post',title:'11/25 입고리스트',shipmentId:'shipment',expectedDate:'2026-11-25',receivedDate:'2026-11-26',quantity:3,revision:1,note:'위해',detail:{shipment:{shipmentNo:'CN'},items:[{id:'a',sku:'100-0001',productName:'흰색 컵',optionName:'대',warehouseCode:'중국'}],pallets:[],boxes:[{id:'b',boxNo:'1',palletId:null}],boxItems:[{boxId:'b',shipmentItemId:'a',quantity:3}]}}
afterEach(()=>vi.unstubAllGlobals())
it('shows historical inbound dates, searches text and opens printable snapshot links',async()=>{
 const fetch=vi.fn().mockImplementation(async(url:string,options?:RequestInit)=>({ok:true,json:async()=>options?.method==='PATCH'?{post:{...entry,revision:2}}:url.includes('?id=')?{post:entry}:{posts:[entry]}}))
 vi.stubGlobal('fetch',fetch)
 render(<InboundBoardPanel postId="post" onSelect={vi.fn()} />)
 await screen.findByText('흰색 컵')
 expect(screen.getByText(/실입고 2026-11-26/)).toBeTruthy()
 expect(screen.getByRole('link',{name:'인쇄용 보기'}).getAttribute('href')).toContain('format=print')
 expect(screen.getByRole('link',{name:'엑셀 다운로드'}).getAttribute('href')).toContain('format=excel')
 fireEvent.change(screen.getByRole('textbox',{name:'입고리스트 상품 검색'}),{target:{value:'컵 대'}})
 fireEvent.click(screen.getByRole('button',{name:'검색'}))
 await waitFor(()=>expect(fetch).toHaveBeenCalledWith(expect.stringContaining('q=%EC%BB%B5%20%EB%8C%80'),expect.anything()))
 fireEvent.change(screen.getByRole('spinbutton', { name: /화물차 비용/ }), { target: { value: '120000' } })
 fireEvent.change(screen.getByRole('textbox', { name: '특이사항' }), { target: { value: '박스 파손 1건' } })
 fireEvent.click(screen.getByRole('button',{name:'입고 메모 저장'}))
 await waitFor(()=>expect(fetch).toHaveBeenCalledWith('/api/purchasing/inbound-board',expect.objectContaining({method:'PATCH',body:expect.stringContaining('"freightKrw":120000,"note":"박스 파손 1건"')})))
})

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams('category=inbound-list'),
}))

it('shows the default tabs without a separate category request', async () => {
  const fetchPosts = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ posts: [] }) })
  vi.stubGlobal('fetch', fetchPosts)
  render(<InboundBoardWorkspace />)
  await screen.findByText(/0건 · 최근 입고 예정일/ )
  expect(fetchPosts.mock.calls.every(([url]) => !String(url).includes('categories='))).toBe(true)
  expect(screen.getByRole('link', { name: '전체' })).toBeTruthy()
  expect(screen.getByRole('link', { name: '품절리스트' })).toBeTruthy()
  expect(screen.getByRole('button', { name: '입고정보 작성' })).toBeTruthy()
})
