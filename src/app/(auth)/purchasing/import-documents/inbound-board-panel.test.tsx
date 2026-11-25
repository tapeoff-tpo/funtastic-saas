import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { InboundBoardPanel } from './inbound-board-panel'
const entry={id:'post',title:'11/25 입고리스트',shipmentId:'shipment',expectedDate:'2026-11-25',receivedDate:'2026-11-26',quantity:3,revision:1,note:'위해',detail:{shipment:{shipmentNo:'CN'},items:[{id:'a',sku:'100-0001',productName:'흰색 컵',optionName:'대',warehouseCode:'중국'}],pallets:[],boxes:[{id:'b',boxNo:'1',palletId:null}],boxItems:[{boxId:'b',shipmentItemId:'a',quantity:3}]}}
afterEach(()=>vi.unstubAllGlobals())
it('shows historical inbound dates, searches text and opens printable snapshot links',async()=>{
 const fetch=vi.fn().mockImplementation(async(url:string,options?:RequestInit)=>({ok:true,json:async()=>options?.method==='PATCH'?{post:{...entry,revision:2}}:url.includes('?id=')?{post:entry}:{posts:[entry]}}))
 vi.stubGlobal('fetch',fetch)
 render(<InboundBoardPanel postId="post" onSelect={vi.fn()} />)
 await screen.findByText('흰색 컵')
 expect(screen.getByText(/실입고 2026-11-26/)).toBeTruthy()
 expect(screen.getByRole('link',{name:'인쇄용 보기'}).getAttribute('href')).toContain('group=pallet&format=print')
 fireEvent.click(screen.getByRole('radio',{name:'박스 기준'}))
 expect(screen.getByRole('link',{name:'엑셀 다운로드'}).getAttribute('href')).toContain('group=box&format=excel')
 fireEvent.change(screen.getByRole('textbox',{name:'입고리스트 상품 검색'}),{target:{value:'컵 대'}})
 fireEvent.click(screen.getByRole('button',{name:'검색'}))
 await waitFor(()=>expect(fetch).toHaveBeenCalledWith(expect.stringContaining('q=%EC%BB%B5%20%EB%8C%80'),expect.anything()))
 fireEvent.click(screen.getByRole('button',{name:'입고 날짜 저장'}))
 await waitFor(()=>expect(fetch).toHaveBeenCalledWith('/api/purchasing/inbound-board',expect.objectContaining({method:'PATCH',body:expect.stringContaining('"revision":1')})))
})
