'use client'

import { useRef, useState } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { Check, ChevronLeft, ChevronRight, FileSpreadsheet, Search, X } from 'lucide-react'

type CategoryTemplate = { id: string; name: string; sheets: Array<{ name: string }> }
type CategoryTemplatePickerProps = {
  label: string
  value: string
  templates: CategoryTemplate[]
  onChange: (value: string) => void
}

const PAGE_SIZE = 20
const buttonClass = 'inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border bg-background px-3 text-xs font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40'
const normalizedSearch = (value: string) => value.normalize('NFKC').toLocaleLowerCase('ko-KR').replace(/[\s_>·]+/g, '')

export function CategoryTemplatePicker({ label, value, templates, onChange }: CategoryTemplatePickerProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const searchInput = useRef<HTMLInputElement>(null)
  const choices = templates.flatMap(template => template.sheets.map(sheet => ({
    value: `${template.id}:${sheet.name}`,
    sheetName: sheet.name,
    categoryName: sheet.name.replace(/^QF_\d+_/, ''),
    fileName: template.name,
  })))
  const selected = choices.find(choice => choice.value === value)
  const query = normalizedSearch(search)
  const filtered = choices.filter(choice => !query || normalizedSearch(`${choice.sheetName} ${choice.fileName}`).includes(query))
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, pages - 1)
  const visible = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)

  function choose(next: string) {
    onChange(next)
    setOpen(false)
  }

  return <Dialog.Root open={open} onOpenChange={next => {
    if (next) { setSearch(''); setPage(0) }
    setOpen(next)
  }}>
    <Dialog.Trigger render={props => <button {...props} type="button" aria-label={label} title={selected ? `${selected.categoryName} · ${selected.fileName}` : '카테고리 엑셀 양식 선택'} className={`${buttonClass} w-full min-w-0 max-w-full justify-between text-left`}>
      <span className="truncate">{selected?.categoryName ?? '업로드한 양식 선택'}</span><Search aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
    </button>} />
    <Dialog.Portal>
      <Dialog.Backdrop className="fixed inset-0 z-[160] bg-black/40" />
      <Dialog.Popup initialFocus={searchInput} className="fixed left-1/2 top-1/2 z-[161] flex max-h-[min(85dvh,800px)] w-[calc(100vw-2rem)] max-w-4xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border bg-background text-foreground shadow-xl focus:outline-none">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b px-5 py-4">
          <div><Dialog.Title className="text-base font-semibold">카테고리 엑셀 양식 선택</Dialog.Title><Dialog.Description className="sr-only">카테고리와 원본 파일명을 검색하고 한 페이지에 20개씩 확인하여 양식을 선택합니다.</Dialog.Description></div>
          <Dialog.Close render={props => <button {...props} type="button" aria-label="양식 선택 닫기" className="rounded p-1.5 text-muted-foreground hover:bg-muted"><X aria-hidden="true" className="size-4" /></button>} />
        </header>
        <div className="shrink-0 space-y-2 px-5 py-3">
          <label className="flex items-center gap-2 rounded-md border bg-background px-3"><Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" /><input ref={searchInput} aria-label="카테고리 양식 검색" className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder="카테고리·시트명·파일명 검색" value={search} onChange={event => { setSearch(event.target.value); setPage(0) }} /></label>
          <p className="text-xs text-muted-foreground">검색결과 {filtered.length}개</p>
        </div>
        <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4 border-y bg-muted/40 px-5 py-2 text-xs font-medium text-muted-foreground"><span>카테고리</span><span>원본 파일</span></div>
        <ul aria-label="카테고리 양식 목록" className="min-h-0 overflow-y-auto overscroll-contain">
          {visible.map(choice => <li key={choice.value} className="border-b last:border-0"><button type="button" aria-label={`${choice.sheetName} · ${choice.fileName} 선택`} aria-pressed={value === choice.value} className={`grid w-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-4 px-5 py-3 text-left text-xs hover:bg-muted/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-600 ${value === choice.value ? 'bg-blue-50 text-blue-900' : ''}`} onClick={() => choose(choice.value)}>
            <span className="flex min-w-0 items-start gap-2"><FileSpreadsheet aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 break-words leading-5">{choice.categoryName}{value === choice.value && <span className="ml-2 inline-flex items-center gap-0.5 text-[10px] font-semibold text-blue-700"><Check aria-hidden="true" className="size-3" />선택됨</span>}</span></span>
            <span className="min-w-0 break-words leading-5 text-muted-foreground">{choice.fileName}</span>
          </button></li>)}
          {!visible.length && <li className="px-5 py-12 text-center text-sm text-muted-foreground">{choices.length ? '검색 조건에 맞는 양식이 없습니다.' : '카테고리 엑셀을 업로드해주세요.'}</li>}
        </ul>
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t px-5 py-3">
          <button type="button" className={buttonClass} disabled={!value} onClick={() => choose('')}>양식 선택 해제</button>
          <div className="flex items-center gap-3"><button type="button" aria-label="이전 페이지" className={buttonClass} disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft aria-hidden="true" className="size-3.5" />이전</button><span aria-label="현재 페이지" className="text-xs tabular-nums">{currentPage + 1} / {pages} 페이지</span><button type="button" aria-label="다음 페이지" className={buttonClass} disabled={currentPage >= pages - 1} onClick={() => setPage(currentPage + 1)}>다음<ChevronRight aria-hidden="true" className="size-3.5" /></button></div>
        </footer>
      </Dialog.Popup>
    </Dialog.Portal>
  </Dialog.Root>
}
