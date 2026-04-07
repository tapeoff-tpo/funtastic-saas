'use client'

import { useActionState, useEffect } from 'react'
import { toast } from 'sonner'
import { saveCompanySettings } from './actions'

interface CompanySettingsFormProps {
  defaultValues: {
    companyName: string
    phone: string
    address: string
    zipCode: string
  }
}

export function CompanySettingsForm({ defaultValues }: CompanySettingsFormProps) {
  const [state, formAction, isPending] = useActionState(saveCompanySettings, null)

  useEffect(() => {
    if (state?.success) {
      toast.success('저장되었습니다.')
    } else if (state?.error) {
      toast.error(state.error)
    }
  }, [state])

  return (
    <form action={formAction} className="space-y-6 max-w-lg">
      <div className="space-y-2">
        <label htmlFor="companyName" className="block text-sm font-medium">
          회사명
        </label>
        <input
          id="companyName"
          name="companyName"
          type="text"
          defaultValue={defaultValues.companyName}
          className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          placeholder="예: 판타스틱"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="phone" className="block text-sm font-medium">
          전화번호
        </label>
        <input
          id="phone"
          name="phone"
          type="text"
          defaultValue={defaultValues.phone}
          className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          placeholder="예: 02-1234-5678"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="address" className="block text-sm font-medium">
          주소
        </label>
        <input
          id="address"
          name="address"
          type="text"
          defaultValue={defaultValues.address}
          className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          placeholder="예: 서울시 강남구 테헤란로 123"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="zipCode" className="block text-sm font-medium">
          우편번호
        </label>
        <input
          id="zipCode"
          name="zipCode"
          type="text"
          defaultValue={defaultValues.zipCode}
          className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          placeholder="예: 06234"
        />
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="rounded-lg bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {isPending ? '저장 중...' : '저장'}
      </button>
    </form>
  )
}
