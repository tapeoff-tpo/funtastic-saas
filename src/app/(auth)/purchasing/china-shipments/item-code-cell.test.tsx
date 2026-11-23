import { expect, it } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ItemCodeCell } from './item-code-cell'
it('clips long sample codes and allows keyboard scrolling to the end', () => {
  const code = 'SAMPLE-4da3f079-9cc1-4f56-a810-e026e441885f'
  render(<ItemCodeCell code={code} />)
  const cell = screen.getByLabelText(`품목코드 ${code}`)
  expect(cell).toHaveClass('overflow-x-auto', 'whitespace-nowrap')
  expect(cell).toHaveAttribute('title', code)
  fireEvent.keyDown(cell, { key: 'ArrowRight' })
  expect(cell.scrollLeft).toBe(40)
  fireEvent.keyDown(cell, { key: 'ArrowLeft' })
  expect(cell.scrollLeft).toBe(0)
})
