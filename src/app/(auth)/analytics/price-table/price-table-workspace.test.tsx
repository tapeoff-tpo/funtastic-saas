import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PriceTableWorkspace } from './price-table-workspace'

afterEach(() => { cleanup(); localStorage.clear() })

describe('price table mall selection', () => {
  it('selects every mall initially and keeps baseline prices pinned when clearing', () => {
    render(<PriceTableWorkspace rows={[]} initialView="compare" />)
    fireEvent.click(screen.getByText("몰 선택·그룹 ▾"))
    const inputs = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(inputs.length).toBeGreaterThan(6)
    expect(inputs.every(input => input.checked)).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '몰 선택 해제' }))
    expect(inputs.filter(input => input.checked)).toHaveLength(2)
    expect(inputs.filter(input => input.disabled)).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: '전체 선택' }))
    expect(inputs.every(input => input.checked)).toBe(true)
  })
  it('restores a saved custom mall group in one click', () => {
    render(<PriceTableWorkspace rows={[]} initialView="compare" />)
    fireEvent.click(screen.getByText("몰 선택·그룹 ▾"))
    fireEvent.click(screen.getByRole('button', { name: '몰 선택 해제' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '쿠팡' }))
    fireEvent.change(screen.getByRole('textbox', { name: '몰 그룹 이름' }), { target: { value: 'B2C몰' } })
    fireEvent.click(screen.getByRole('button', { name: '현재 선택을 그룹 저장' }))
    fireEvent.click(screen.getByRole('button', { name: '전체 선택' }))
    fireEvent.click(screen.getByRole('button', { name: 'B2C몰' }))
    expect((screen.getAllByRole('checkbox') as HTMLInputElement[]).filter(input => input.checked)).toHaveLength(3)
    expect(JSON.parse(localStorage.getItem('price-table-mall-groups-v1')!)).toHaveProperty('B2C몰')
  })
})
