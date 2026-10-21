import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ChinaWorkGuardProvider, useChinaWorkDraft, useChinaWorkGuard } from './unsaved-china-work'

describe('China outbound unsaved-work guard', () => {
  it('saves content before box completion, then pallet completion, regardless of edit order', async () => {
    const saves: string[] = []
    const navigate = vi.fn()
    function Drafts() {
      const guard = useChinaWorkGuard()
      useChinaWorkDraft('pallet-status', {
        kind: 'pallet', label: '파렛트 상태', snapshot: true, savePriority: 2,
        save: async () => { saves.push('pallet'); return true }, discard: () => {},
      })
      useChinaWorkDraft('box-status', {
        kind: 'box', label: '박스 상태', snapshot: true, savePriority: 1,
        save: async () => { saves.push('box'); return true }, discard: () => {},
      })
      useChinaWorkDraft('item-content', {
        kind: 'box', label: '박스 내용', snapshot: true,
        save: async () => { saves.push('content'); return true }, discard: () => {},
      })
      return <button type="button" onClick={() => guard.requestNavigation(navigate)}>이동</button>
    }

    render(<ChinaWorkGuardProvider><Drafts /></ChinaWorkGuardProvider>)
    fireEvent.click(screen.getByRole('button', { name: '이동' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '저장 후 이동' }))
    await waitFor(() => expect(navigate).toHaveBeenCalledOnce())
    expect(saves).toEqual(['content', 'box', 'pallet'])
  })
})
