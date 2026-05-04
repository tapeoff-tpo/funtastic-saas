import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getCompanySettings } from './actions'
import { CompanySettingsForm } from './company-settings-form'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'

export default async function CompanySettingsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const settings = await getCompanySettings(await getWorkspaceUserId(user.id))

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">회사 정보 설정</h1>
        <p className="mt-1 text-muted-foreground">
          발송자 정보를 설정합니다. CJ대한통운 발주서 등에서 사용됩니다.
        </p>
      </div>

      <CompanySettingsForm
        defaultValues={{
          companyName: settings?.companyName ?? '',
          phone: settings?.phone ?? '',
          address: settings?.address ?? '',
          zipCode: settings?.zipCode ?? '',
        }}
      />
    </div>
  )
}
