import { describe, expect, it } from 'vitest'
import { selectDomechangoVisibleOrderRowsForExcel } from '@/scrapers/domechango/scraper'

describe('Domechango RPA order selection', () => {
  it('selects every visible order row even when row checkboxes are visually hidden', () => {
    document.body.innerHTML = `
      <table id="order_list">
        <thead>
          <tr><th><input type="checkbox" name="check_all"></th><th>주문번호</th></tr>
        </thead>
        <tbody>
          <tr><td><input type="checkbox" style="display:none"></td><td>202605270001 신규주문</td></tr>
          <tr><td><input type="checkbox" style="display:none"></td><td>202605270002 신규주문</td></tr>
          <tr><td><input type="checkbox" style="display:none"></td><td>202605270003 신규주문</td></tr>
        </tbody>
      </table>
    `

    const selected = selectDomechangoVisibleOrderRowsForExcel(document)

    expect(selected).toBe(3)
    expect([...document.querySelectorAll<HTMLInputElement>('tbody input[type="checkbox"]')]
      .map((checkbox) => checkbox.checked)).toEqual([true, true, true])
    expect(document.querySelector<HTMLInputElement>('thead input[type="checkbox"]')?.checked).toBe(false)
  })

  it('does not count disabled or non-order rows as selected orders', () => {
    document.body.innerHTML = `
      <div id="order_list">
        <div class="tui-grid-row"><input type="checkbox"><span>검색조건</span></div>
        <div class="tui-grid-row"><input type="checkbox" disabled><span>202605270004 신규주문</span></div>
        <div class="tui-grid-row"><input type="checkbox"><span>202605270005 배송준비중</span></div>
        <div class="tui-grid-row"><input type="checkbox"><span>202605270006 배송준비중</span></div>
      </div>
    `

    const selected = selectDomechangoVisibleOrderRowsForExcel(document)

    expect(selected).toBe(2)
    expect([...document.querySelectorAll<HTMLInputElement>('.tui-grid-row input[type="checkbox"]')]
      .map((checkbox) => checkbox.checked)).toEqual([false, false, true, true])
  })
})
