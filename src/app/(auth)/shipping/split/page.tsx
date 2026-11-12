/**
 * 분리출고 관리 페이지
 *
 * 하나의 주문을 여러 개의 송장으로 나눠서 출고.
 * 주문번호로 조회 → 상품 항목 확인 → 송장 N개 입력 → 저장
 */

import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/auth/server'
import { SplitShippingClient } from './client'

export const metadata: Metadata = {
  title: '분리출고',
}

export default async function SplitShippingPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">분리출고</h1>
      </div>

      <SplitShippingClient />
    </div>
  )
}
