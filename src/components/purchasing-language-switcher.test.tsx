import { createPortal } from 'react-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

function InspectionTranslationFixture() {
  return (
    <div data-app-translate>
      <PurchasingLanguageSwitcher />
      <div role="dialog" aria-label="송장·검수">
        <label htmlFor="inspection-tracking">운송장번호</label>
        <a href="https://www.baidu.com" title="바이두에서 송장번호 조회" aria-label="바이두에서 송장번호 조회">조회</a>
        <p>구매완료 수량을 임시 기본값으로 넣었습니다. 실제 입고수량을 확인한 뒤 저장하세요.</p>
        <p>실제 입고수량이 구매수량과 다르면 아래 비고를 입력해주세요.</p>
        <label htmlFor="inspection-note">수량 차이 비고</label>
        <textarea id="inspection-note" placeholder="예: 공급처 출고 누락 10개, 다음 출고에 보충 예정" />
        <p>수량이 다르면 확인 체크와 비고 입력 후에만 검수완료할 수 있습니다.</p>
        <button type="button">박스 복사</button>
        <p>1번 박스 복사</p>
        <label htmlFor="copy-count">추가할 박스 개수</label><input id="copy-count" type="number" />
        <h3>검수 오류 등록</h3>
        <p>오류 설명만으로 등록할 수 있으며, 사진은 선택입니다.</p>
        <button type="button">사진 첨부 (선택)</button>
        <p>자동 압축 후 장당 700KB 이하로 저장 · 최대 5장</p>
        <h3>구매 정보 수정</h3><button type="button">구매수량 정정 저장</button>
        <p data-no-translate>수량 부족 · 파손 신고 원문</p>
      </div>
    </div>
  )
}

describe('PurchasingLanguageSwitcher', () => {
  beforeEach(() => {
    window.localStorage.clear()
    document.documentElement.lang = 'ko'
  })

  afterEach(() => {
    vi.restoreAllMocks()
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

  it('translates only changed nodes after a large table is already in Chinese', async () => {
    render(<div data-app-translate><PurchasingLanguageSwitcher /><div data-testid="table">{Array.from({ length: 800 }, (_, i) => <p key={i}>저장</p>)}</div><div data-testid="updates" /></div>)
    fireEvent.click(await screen.findByRole('button', { name: '中文' }))
    await waitFor(() => expect(screen.getByTestId('table').firstChild).toHaveTextContent('保存'))
    const walker = vi.spyOn(document, 'createTreeWalker')
    const button = document.createElement('button')
    button.textContent = '삭제'
    screen.getByTestId('updates').appendChild(button)
    await waitFor(() => expect(button).toHaveTextContent('删除'))
    expect(walker.mock.calls.length).toBeGreaterThan(0)
    expect(walker.mock.calls.every(([root]) => root === button)).toBe(true)
    const before = walker.mock.calls.length
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(walker).toHaveBeenCalledTimes(before)
    button.textContent = '저장'
    await waitFor(() => expect(button).toHaveTextContent('保存'))
    fireEvent.click(screen.getByRole('button', { name: '한국어' }))
    await waitFor(() => expect(button).toHaveTextContent('저장'))
    expect(screen.getByTestId('table').firstChild).toHaveTextContent('저장')
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

  it('translates automatic inventory-status empty-quantity guidance', async () => {
    render(<GlobalTranslationFixture route="dashboard" dynamicLabel="빈 칸 또는 0 수량 2칸은 재고 없음으로 처리합니다." />)

    fireEvent.click(await screen.findByRole('button', { name: '中文' }))

    await waitFor(() => {
      expect(screen.getByTestId('dynamic-label')).toHaveTextContent('空白或 0 数量的 2 格会按无库存处理。')
    })
  })

  it('translates all inspection labels, guidance, and placeholders added after the Chinese switch is active', async () => {
    render(<InspectionTranslationFixture />)

    fireEvent.click(await screen.findByRole('button', { name: '中文' }))

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: '运单·验货' })).toBeInTheDocument()
      expect(screen.getByText('运单号')).toBeInTheDocument()
      expect(screen.getByText('已将采购完成数量填为临时默认值。请确认实际收货数量后再保存。')).toBeInTheDocument()
      expect(screen.getByText('实际收货数量与采购数量不一致时，请在下方填写备注。')).toBeInTheDocument()
      expect(screen.getByText('数量差异备注')).toBeInTheDocument()
      expect(screen.getByText('数量不一致时，只有勾选确认并填写备注后才能完成验货。')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '复制箱子' })).toBeInTheDocument()
      expect(screen.getByText('复制第 1 箱')).toBeInTheDocument()
      expect(screen.getByText('登记验货异常')).toBeInTheDocument()
      expect(screen.getByText('仅填写异常说明即可登记，照片为选填。')).toBeInTheDocument()
      expect(screen.getByText('自动压缩后每张不超过 700KB · 最多 5 张')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '保存采购数量更正' })).toBeInTheDocument()
      expect(screen.getByText('수량 부족 · 파손 신고 원문')).toBeInTheDocument()
    })
    expect(screen.getByPlaceholderText('例如：供应商漏发 10 个，下次发货补齐。')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '在百度查询运单号' })).toHaveAttribute('title', '在百度查询运单号')
  })
})
