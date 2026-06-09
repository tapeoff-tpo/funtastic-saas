'use client'

import { useMemo, useState, useTransition } from 'react'
import { Pencil, Plus, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

type BoxCostRate = {
  id: string
  packageName: string
  unitCost: string
  effectiveFrom: string
  isActive: boolean
}

const emptyForm = {
  packageName: '',
  unitCost: '',
  effectiveFrom: new Date().toISOString().slice(0, 10),
  isActive: true,
}

export function BoxCostSettings({ rates }: { rates: BoxCostRate[] }) {
  const router = useRouter()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [isPending, startTransition] = useTransition()
  const knownNames = useMemo(() => Array.from(new Set(rates.map((rate) => rate.packageName))), [rates])

  function reset() {
    setEditingId(null)
    setForm({ ...emptyForm, effectiveFrom: new Date().toISOString().slice(0, 10) })
  }

  function edit(rate: BoxCostRate) {
    setEditingId(rate.id)
    setForm({
      packageName: rate.packageName,
      unitCost: String(Number(rate.unitCost)),
      effectiveFrom: rate.effectiveFrom,
      isActive: rate.isActive,
    })
  }

  function save() {
    startTransition(async () => {
      const response = await fetch(editingId ? `/api/analytics/box-costs/${editingId}` : '/api/analytics/box-costs', {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          packageName: form.packageName,
          unitCost: Number(form.unitCost),
          effectiveFrom: form.effectiveFrom,
          isActive: form.isActive,
        }),
      })
      const body = await response.json()
      if (!response.ok) {
        toast.error(body.error ?? '박스비 설정을 저장하지 못했습니다.')
        return
      }
      toast.success(editingId ? '박스비 설정을 수정했습니다.' : '박스비 설정을 추가했습니다.')
      reset()
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-card">
        <div className="border-b px-4 py-3">
          <h2 className="text-base font-semibold">박스별 단가 설정</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            같은 박스의 단가가 변경되면 기존 줄을 수정하지 말고 새 적용 시작일로 추가해주세요.
          </p>
        </div>
        <div className="grid gap-3 p-4 md:grid-cols-[1fr_180px_180px_auto_auto] md:items-end">
          <label className="grid gap-1 text-sm">
            <span className="font-medium">박스명</span>
            <input
              value={form.packageName}
              onChange={(event) => setForm({ ...form, packageName: event.target.value })}
              list="box-cost-known-names"
              placeholder="예: 소, 중, 대"
              className="h-9 rounded-md border bg-background px-3"
            />
            <datalist id="box-cost-known-names">
              {knownNames.map((name) => <option key={name} value={name} />)}
            </datalist>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">박스 단가</span>
            <input
              value={form.unitCost}
              onChange={(event) => setForm({ ...form, unitCost: event.target.value })}
              inputMode="numeric"
              placeholder="0"
              className="h-9 rounded-md border bg-background px-3 text-right"
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">적용 시작일</span>
            <input
              type="date"
              value={form.effectiveFrom}
              onChange={(event) => setForm({ ...form, effectiveFrom: event.target.value })}
              className="h-9 rounded-md border bg-background px-3"
            />
          </label>
          <label className="flex h-9 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
            />
            사용
          </label>
          <div className="flex gap-2">
            <Button type="button" onClick={save} disabled={isPending}>
              {editingId ? <Pencil /> : <Plus />}
              {editingId ? '수정' : '추가'}
            </Button>
            {editingId ? (
              <Button type="button" variant="outline" size="icon" onClick={reset} title="수정 취소">
                <X />
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="rounded-lg border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">박스명</th>
                <th className="px-3 py-2 text-right font-medium">박스 단가</th>
                <th className="px-3 py-2 text-left font-medium">적용 시작일</th>
                <th className="px-3 py-2 text-left font-medium">상태</th>
                <th className="w-16 px-3 py-2"><span className="sr-only">수정</span></th>
              </tr>
            </thead>
            <tbody>
              {rates.length === 0 ? (
                <tr><td colSpan={5} className="px-3 py-10 text-center text-muted-foreground">등록된 박스 단가가 없습니다.</td></tr>
              ) : rates.map((rate) => (
                <tr key={rate.id} className="border-t">
                  <td className="px-3 py-2 font-medium">{rate.packageName}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatWon(Number(rate.unitCost))}</td>
                  <td className="px-3 py-2">{rate.effectiveFrom}</td>
                  <td className="px-3 py-2">
                    <span className={rate.isActive ? 'text-emerald-700' : 'text-muted-foreground'}>
                      {rate.isActive ? '사용' : '미사용'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button type="button" variant="ghost" size="icon" onClick={() => edit(rate)} title="박스비 설정 수정">
                      <Pencil />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function formatWon(value: number): string {
  return `${Math.round(value).toLocaleString('ko-KR')}원`
}
