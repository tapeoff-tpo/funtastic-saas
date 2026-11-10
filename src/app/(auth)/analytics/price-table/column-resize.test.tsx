import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { ColumnResizeHandle } from './column-resize'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function Harness() {
  const [width, setWidth] = useState(96)
  return <ColumnResizeHandle label="상품코드" width={width} onResize={setWidth} />
}

describe('price table column resizing', () => {
  it('supports keyboard resizing without a mouse', () => {
    render(<Harness />)
    const separator=screen.getByRole('separator',{name:'상품코드 열 너비'})
    fireEvent.keyDown(separator,{key:'ArrowRight'})
    expect(separator.getAttribute('aria-valuenow')).toBe('104')
    fireEvent.keyDown(separator,{key:'ArrowLeft'})
    expect(separator.getAttribute('aria-valuenow')).toBe('96')
  })
  it('drags using pointer capture and stops resizing after release', () => {
    vi.stubGlobal('PointerEvent', MouseEvent)
    render(<Harness />)
    const separator=screen.getByRole('separator',{name:'상품코드 열 너비'})
    separator.setPointerCapture=vi.fn()
    separator.hasPointerCapture=()=>true
    separator.releasePointerCapture=vi.fn()
    fireEvent.pointerDown(separator,{clientX:100})
    fireEvent.pointerMove(separator,{clientX:150})
    expect(separator.getAttribute('aria-valuenow')).toBe('146')
    fireEvent.pointerUp(separator)
    fireEvent.pointerMove(separator,{clientX:200})
    expect(separator.getAttribute('aria-valuenow')).toBe('146')
  })
})
