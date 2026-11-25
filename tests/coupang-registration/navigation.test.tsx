import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useWorkbenchNavigation } from '@/app/(auth)/operations/coupang-registration/use-workbench-navigation'

const path = '/operations/coupang-registration'
async function traverse(direction: 'back' | 'forward') {
  await act(async () => {
    const changed = new Promise<void>(resolve => window.addEventListener('popstate', () => resolve(), { once: true }))
    window.history[direction]()
    await changed
  })
}

beforeEach(() => {
  window.history.replaceState({ previousMenu: true }, '', '/costs')
  window.history.pushState({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: ['router-tree'] }, '', path)
})

describe('Coupang workbench browser navigation', () => {
  it('visits each stage in reverse and forward order before leaving for the previous menu', async () => {
    const { result } = renderHook(() => useWorkbenchNavigation())
    act(() => result.current.navigate({ stage: 'information' }))
    act(() => result.current.navigate({ stage: 'registered' }))
    expect(window.history.state).toMatchObject({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: ['router-tree'] })
    for (const stage of ['information', 'pricing']) {
      await traverse('back')
      expect(result.current.stage).toBe(stage)
      expect(window.location.pathname).toBe(path)
    }
    await traverse('back')
    expect(window.location.pathname).toBe('/costs')
    for (const stage of ['pricing', 'information', 'registered']) {
      await traverse('forward')
      expect(result.current.stage).toBe(stage)
      expect(window.location.pathname).toBe(path)
    }
  })

  it('closes the product search and editor one screen at a time and reopens both with Forward', async () => {
    const { result } = renderHook(() => useWorkbenchNavigation())
    act(() => result.current.navigate({ activeId: 'row-1' }))
    act(() => result.current.navigate({ catalogTarget: { bundleId: 'row-1' } }))
    await traverse('back')
    expect(result.current).toMatchObject({ activeId: 'row-1', catalogTarget: null })
    await traverse('back')
    expect(result.current).toMatchObject({ activeId: '', catalogTarget: null })
    await traverse('forward')
    expect(result.current).toMatchObject({ activeId: 'row-1', catalogTarget: null })
    await traverse('forward')
    expect(result.current).toMatchObject({ activeId: 'row-1', catalogTarget: { bundleId: 'row-1' } })
  })

  it('does not add a history entry for the same screen', async () => {
    const { result } = renderHook(() => useWorkbenchNavigation())
    const length = window.history.length
    act(() => result.current.navigate({ stage: 'pricing', activeId: '' }))
    expect(window.history.length).toBe(length)
    await traverse('back')
    expect(window.location.pathname).toBe('/costs')
  })

  it('does not reopen a row from the old draft after another draft is loaded', async () => {
    const { result } = renderHook(() => useWorkbenchNavigation())
    act(() => result.current.navigate({ stage: 'information' }))
    act(() => result.current.navigate({ activeId: 'old-draft-row' }))
    act(() => result.current.reset({ stage: 'pricing', activeId: '', catalogTarget: null }))
    await traverse('back')
    expect(result.current).toMatchObject({ stage: 'pricing', activeId: '', catalogTarget: null })
    await traverse('forward')
    expect(result.current).toMatchObject({ stage: 'pricing', activeId: '', catalogTarget: null })
  })
})
