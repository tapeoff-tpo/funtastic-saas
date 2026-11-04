import type { Metadata } from 'next'
import { assertMenuAccess } from '@/lib/auth/menu-access'
import { CoupangRegistrationWorkbench } from './workbench'

export const metadata: Metadata = { title: '쿠팡상품등록' }
export default async function CoupangRegistrationPage() {
  await assertMenuAccess('/operations/coupang-registration')
  return <CoupangRegistrationWorkbench />
}
