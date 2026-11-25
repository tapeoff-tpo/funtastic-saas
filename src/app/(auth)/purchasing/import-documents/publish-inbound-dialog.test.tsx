import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { PublishInboundDialog } from './publish-inbound-dialog'
afterEach(()=>vi.unstubAllGlobals())
it('publishes chosen inbound dates without sending client-authored shipment rows',async()=>{
 const publish=vi.fn();const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({post:{id:'post'},created:true})});vi.stubGlobal('fetch',fetch)
 render(<PublishInboundDialog shipmentId="shipment" onPublished={publish} onClose={vi.fn()} />)
 fireEvent.change(screen.getByLabelText('입고 예정일'),{target:{value:'2026-11-26'}})
 fireEvent.click(screen.getByRole('button',{name:'게시하기'}))
 await waitFor(()=>expect(publish).toHaveBeenCalledWith('post'))
 const body=JSON.parse(fetch.mock.calls[0][1].body)
 expect(body).toEqual({shipmentId:'shipment',title:'2026-11-26 입고리스트',expectedDate:'2026-11-26',receivedDate:null,note:''})
})
