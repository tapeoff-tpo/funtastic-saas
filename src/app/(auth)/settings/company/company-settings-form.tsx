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
    businessRegistrationNumber: string
    representativeName: string
    businessType: string
    businessItem: string
    bankAccount: string
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
        <label htmlFor="businessRegistrationNumber" className="block text-sm font-medium">
          사업자등록번호
        </label>
        <input
          id="businessRegistrationNumber"
          name="businessRegistrationNumber"
          type="text"
          defaultValue={defaultValues.businessRegistrationNumber}
          className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          placeholder="예: 123-45-67890"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="representativeName" className="block text-sm font-medium">
          대표자명
        </label>
        <input
          id="representativeName"
          name="representativeName"
          type="text"
          defaultValue={defaultValues.representativeName}
          className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          placeholder="예: 홍길동"
        />
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <div className="space-y-2">
          <label htmlFor="businessType" className="block text-sm font-medium">업태</label>
          <input id="businessType" name="businessType" type="text" defaultValue={defaultValues.businessType} className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
        </div>
        <div className="space-y-2">
          <label htmlFor="businessItem" className="block text-sm font-medium">종목</label>
          <input id="businessItem" name="businessItem" type="text" defaultValue={defaultValues.businessItem} className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor="bankAccount" className="block text-sm font-medium">
          견적서 입금계좌
        </label>
        <input
          id="bankAccount"
          name="bankAccount"
          type="text"
          defaultValue={defaultValues.bankAccount}
          className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          placeholder="예: 기업은행 000-000000-00-000"
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
