import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ShortMeetingUpload } from './short-meeting-upload'

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

const response = {
  success: true, fileName: 'orders.xlsx', meetingDate: '2026-11-12', rowCount: 2, productCount: 1, totalQuantity: 3,
  warnings: ['확인이 필요한 행이 있습니다.'], preview: [{ sku: 'A-1', productName: '상품', optionName: '옵션', quantity: 3 }],
}

describe('ShortMeetingUpload', () => {
  it('previews the chosen file before applying it, then opens the selected date', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => response }).mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) })
    vi.stubGlobal('fetch', fetchMock)
    render(<ShortMeetingUpload defaultDate="2026-11-12" />)
    const file = new File(['file'], 'orders.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    fireEvent.change(screen.getByLabelText('주문서 엑셀'), { target: { files: [file] } })
    expect(screen.queryByRole('button', { name: '숏미팅에 반영' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '미리보기' }))
    expect(await screen.findByText('A-1')).toBeInTheDocument()
    expect(screen.getByText('확인이 필요한 행이 있습니다.')).toBeInTheDocument()
    const previewForm = fetchMock.mock.calls[0][1].body as FormData
    expect(previewForm.get('file')).toBe(file)
    expect(previewForm.get('meetingDate')).toBe('2026-11-12')
    expect(previewForm.get('action')).toBe('preview')
    fireEvent.click(screen.getByRole('button', { name: '숏미팅에 반영' }))
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/analytics/short-meeting?date=2026-11-12'))
    expect((fetchMock.mock.calls[1][1].body as FormData).get('action')).toBe('apply')
    expect(router.refresh).toHaveBeenCalled()
  })

  it('invalidates a preview when the date changes and shows upload errors', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => response }).mockResolvedValueOnce({ ok: false, json: async () => ({ success: false, error: '양식을 확인해 주세요.' }) })
    vi.stubGlobal('fetch', fetchMock)
    render(<ShortMeetingUpload defaultDate="2026-11-12" />)
    fireEvent.change(screen.getByLabelText('주문서 엑셀'), { target: { files: [new File(['file'], 'orders.xlsx')] } })
    fireEvent.click(screen.getByRole('button', { name: '미리보기' }))
    await screen.findByText('A-1')
    fireEvent.change(screen.getByLabelText('기준일'), { target: { value: '2026-11-13' } })
    expect(screen.queryByRole('button', { name: '숏미팅에 반영' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '미리보기' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('양식을 확인해 주세요.')
    expect(router.push).not.toHaveBeenCalled()
  })

  it('requires a new preview when another file is selected', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => response }))
    render(<ShortMeetingUpload defaultDate="2026-11-12" />)
    const input = screen.getByLabelText('주문서 엑셀')
    fireEvent.change(input, { target: { files: [new File(['one'], 'one.xlsx')] } })
    fireEvent.click(screen.getByRole('button', { name: '미리보기' }))
    await screen.findByText('A-1')
    fireEvent.change(input, { target: { files: [new File(['two'], 'two.xlsx')] } })
    expect(screen.queryByRole('button', { name: '숏미팅에 반영' })).not.toBeInTheDocument()
  })

  it('accepts an encrypted workbook password for preview and apply, and clears it when a different file is selected', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, json: async () => ({ code: 'excel_password_required', error: '엑셀 파일 암호를 입력해 주세요.' }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ code: 'excel_password_invalid', error: '엑셀 파일 암호가 올바르지 않습니다.' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => response })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) })
    vi.stubGlobal('fetch', fetchMock)
    render(<ShortMeetingUpload defaultDate="2026-11-12" />)
    const fileInput = screen.getByLabelText('주문서 엑셀')
    const passwordInput = screen.getByLabelText('엑셀 암호 (설정된 경우)')
    fireEvent.change(fileInput, { target: { files: [new File(['encrypted'], 'encrypted.xlsx')] } })
    fireEvent.click(screen.getByRole('button', { name: '미리보기' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('암호를 입력')
    expect(passwordInput).toHaveAttribute('type', 'password')
    expect(passwordInput).toHaveAttribute('aria-invalid', 'true')
    expect(passwordInput).toHaveAccessibleDescription('엑셀 파일 암호를 입력해 주세요.')
    fireEvent.change(passwordInput, { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: '미리보기' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('올바르지 않습니다')
    fireEvent.change(passwordInput, { target: { value: ' correct password ' } })
    expect(passwordInput).not.toHaveAttribute('aria-invalid')
    fireEvent.click(screen.getByRole('button', { name: '미리보기' }))
    await screen.findByText('A-1')
    expect((fetchMock.mock.calls[2][1].body as FormData).get('filePassword')).toBe(' correct password ')
    fireEvent.click(screen.getByRole('button', { name: '숏미팅에 반영' }))
    await waitFor(() => expect(router.refresh).toHaveBeenCalled())
    expect((fetchMock.mock.calls[3][1].body as FormData).get('filePassword')).toBe(' correct password ')
    expect(passwordInput).toHaveValue('')

    fireEvent.change(fileInput, { target: { files: [new File(['one'], 'one.xlsx')] } })
    fireEvent.change(passwordInput, { target: { value: 'old password' } })
    fireEvent.change(fileInput, { target: { files: [new File(['two'], 'two.xlsx')] } })
    expect(passwordInput).toHaveValue('')
  })

  it('requires a fresh preview if the password is edited', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => response }))
    render(<ShortMeetingUpload defaultDate="2026-11-12" />)
    fireEvent.change(screen.getByLabelText('주문서 엑셀'), { target: { files: [new File(['file'], 'orders.xlsx')] } })
    fireEvent.click(screen.getByRole('button', { name: '미리보기' }))
    await screen.findByText('A-1')
    fireEvent.change(screen.getByLabelText('엑셀 암호 (설정된 경우)'), { target: { value: 'changed' } })
    expect(screen.queryByRole('button', { name: '숏미팅에 반영' })).not.toBeInTheDocument()
  })
})
