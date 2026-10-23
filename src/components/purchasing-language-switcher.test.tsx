import { createPortal } from 'react-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PurchasingLanguageSwitcher } from './purchasing-language-switcher'

function GlobalTranslationFixture({
  route,
  dynamicLabel,
  withPortal = false,
}: {
  route: 'dashboard' | 'settings'
  dynamicLabel: string
  withPortal?: boolean
}) {
  return (
    <div data-app-translate>
      <PurchasingLanguageSwitcher />
      <nav><span data-testid="navigation-label">대시보드</span></nav>
      <h1 data-testid="route-label">{route === 'dashboard' ? '대시보드' : '설정'}</h1>
      <button data-testid="dynamic-label" type="button">{dynamicLabel}</button>
      <input aria-label="검색" placeholder="검색어를 입력하세요" />
      <p data-no-translate data-testid="product-name">발주</p>
      <p data-no-translate data-testid="product-option">7월 출고 3개</p>
      {withPortal ? createPortal(
        <div role="dialog" aria-label="설정">
          <h2>설정</h2>
          <button type="button">저장</button>
          <span data-no-translate>발주</span>
        </div>,
        document.body,
      ) : null}
    </div>
  )
}

describe('PurchasingLanguageSwitcher', () => {
  beforeEach(() => {
    window.localStorage.clear()
    document.documentElement.lang = 'ko'
  })

  afterEach(() => {
    document.querySelectorAll('[data-sonner-toaster]').forEach((element) => element.remove())
    document.documentElement.lang = 'ko'
  })

  it('keeps Chinese mode active across authenticated screens while preserving product identity values', async () => {
    const { rerender } = render(<GlobalTranslationFixture route="dashboard" dynamicLabel="저장" />)

    fireEvent.click(await screen.findByRole('button', { name: '中文' }))

    await waitFor(() => {
      expect(screen.getByTestId('navigation-label')).toHaveTextContent('仪表盘')
      expect(screen.getByTestId('route-label')).toHaveTextContent('仪表盘')
      expect(screen.getByTestId('dynamic-label')).toHaveTextContent('保存')
    })
    expect(screen.getByRole('textbox', { name: '搜索' })).toHaveAttribute('placeholder', '请输入搜索词')
    expect(screen.getByTestId('product-name')).toHaveTextContent('발주')
    expect(screen.getByTestId('product-option')).toHaveTextContent('7월 출고 3개')

    rerender(<GlobalTranslationFixture route="settings" dynamicLabel="삭제" />)

    await waitFor(() => {
      expect(screen.getByTestId('route-label')).toHaveTextContent('设置')
      expect(screen.getByTestId('dynamic-label')).toHaveTextContent('删除')
    })

    fireEvent.click(screen.getByRole('button', { name: '한국어' }))

    await waitFor(() => {
      expect(screen.getByTestId('route-label')).toHaveTextContent('설정')
      expect(screen.getByTestId('dynamic-label')).toHaveTextContent('삭제')
    })
    expect(screen.getByRole('textbox', { name: '검색' })).toHaveAttribute('placeholder', '검색어를 입력하세요')
  })

  it('translates dialogs and toasts outside the app boundary, then restores them on unmount', async () => {
    const { unmount } = render(<GlobalTranslationFixture route="settings" dynamicLabel="저장" withPortal />)
    const toaster = document.createElement('ol')
    toaster.setAttribute('data-sonner-toaster', '')
    toaster.textContent = '저장되었습니다.'
    document.body.appendChild(toaster)

    fireEvent.click(await screen.findByRole('button', { name: '中文' }))

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: '设置' })).toBeInTheDocument()
      expect(screen.getByRole('dialog')).toHaveTextContent('保存')
      expect(toaster).toHaveTextContent('已保存。')
    })
    expect(screen.getByRole('dialog')).toHaveTextContent('발주')

    unmount()

    expect(document.documentElement.lang).toBe('ko')
    expect(toaster).toHaveTextContent('저장되었습니다.')
  })

  it('translates dynamic SaaS inventory protection messages without translating product data', async () => {
    render(<GlobalTranslationFixture route="dashboard" dynamicLabel="출고 예약 4개보다 적게 줄일 수 없습니다." />)

    fireEvent.click(await screen.findByRole('button', { name: '中文' }))

    await waitFor(() => {
      expect(screen.getByTestId('dynamic-label')).toHaveTextContent('不能减少到低于出库预留的 4 个。')
    })
  })

  it('translates SaaS inventory Excel upload errors, including row-prefixed server errors', async () => {
    const { rerender } = render(<GlobalTranslationFixture route="dashboard" dynamicLabel="xlsx 또는 xlsm 엑셀 파일만 업로드할 수 있습니다." />)

    fireEvent.click(await screen.findByRole('button', { name: '中文' }))

    await waitFor(() => {
      expect(screen.getByTestId('dynamic-label')).toHaveTextContent('仅可上传 xlsx 或 xlsm Excel 文件。')
    })

    rerender(<GlobalTranslationFixture route="dashboard" dynamicLabel="2행: 엑셀의 SaaS재고ID를 현재 목록에서 찾을 수 없습니다." />)

    await waitFor(() => {
      expect(screen.getByTestId('dynamic-label')).toHaveTextContent('第 2 行：无法在当前列表中找到 Excel 的 SaaS 库存 ID。')
    })
  })

  it('translates inventory-status snapshot controls and blank-quantity preview guidance', async () => {
    const { rerender } = render(<GlobalTranslationFixture route="dashboard" dynamicLabel="재고현황의 빈 중국창고 수량을 0으로 반영" />)

    fireEvent.click(await screen.findByRole('button', { name: '中文' }))

    await waitFor(() => {
      expect(screen.getByTestId('dynamic-label')).toHaveTextContent('将库存现状中空白的中国仓库数量按 0 应用')
    })

    rerender(<GlobalTranslationFixture route="dashboard" dynamicLabel="빈 중국창고 수량 2행을 0 재고 대상으로 다시 검토합니다. 기존 SaaS 재고가 없는 행은 새로 등록하지 않습니다." />)

    await waitFor(() => {
      expect(screen.getByTestId('dynamic-label')).toHaveTextContent('将空白中国仓库数量的 2 行重新作为 0 库存对象检查。当前没有 SaaS 库存的行不会新增登记。')
    })
  })
})
