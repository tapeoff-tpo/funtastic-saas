import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { KoreaShippingDocumentPanel } from './korea-shipping-document-panel'

afterEach(() => vi.unstubAllGlobals())
it('reloads the preview on demand while keeping the selected grouping', async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ html: '<table><tbody><tr><td>총중량(kg)</td></tr></tbody></table>' }) })
  vi.stubGlobal('fetch', fetch)
  render(<KoreaShippingDocumentPanel shipmentId="shipment" group="box" onGroupChange={vi.fn()} />)
  await screen.findByText('총중량(kg)')
  fireEvent.click(screen.getByRole('button', { name: '미리보기 새로고침' }))
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
  expect(fetch.mock.calls[1][0]).toContain('group=box&layout=cbm-v2&format=preview&refresh=1')
  await screen.findByText('총중량(kg)')
})
