import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PurchaseInspectionQuantityDisplay } from './purchase-inspection-quantity-display'

describe('inspection received and purchased quantity display', () => {
  it.each([90, 100, 110])('shows actual receipt %i separately from the purchased quantity', (receivedQuantity) => {
    render(<PurchaseInspectionQuantityDisplay receivedQuantity={receivedQuantity} actualPurchaseQuantity={100} requestedQuantity={120} />)
    expect(screen.getByLabelText('실제 입고수량')).toHaveTextContent(String(receivedQuantity))
    expect(screen.getByText('구매수량').parentElement).toHaveTextContent('구매수량 100')
  })

  it('does not present the purchase quantity as received before any receipt quantity was entered', () => {
    render(<PurchaseInspectionQuantityDisplay receivedQuantity={null} actualPurchaseQuantity={1200} requestedQuantity={1500} />)
    expect(screen.getByLabelText('실제 입고수량')).toHaveTextContent('미입력')
    expect(screen.getByText('구매수량').parentElement).toHaveTextContent('구매수량 1,200')
  })

  it('keeps an actual zero receipt visible and falls back to the requested quantity only for a missing purchase quantity', () => {
    render(<PurchaseInspectionQuantityDisplay receivedQuantity={0} actualPurchaseQuantity={null} requestedQuantity={80} />)
    expect(screen.getByLabelText('실제 입고수량')).toHaveTextContent(/^0$/)
    expect(screen.getByText('구매수량').parentElement).toHaveTextContent('구매수량 80')
  })

  it('keeps an explicit zero purchase quantity instead of substituting the requested quantity', () => {
    render(<PurchaseInspectionQuantityDisplay receivedQuantity={0} actualPurchaseQuantity={0} requestedQuantity={80} />)
    expect(screen.getByText('구매수량').parentElement).toHaveTextContent('구매수량 0')
  })
})
