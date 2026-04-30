import { ChangePasswordForm } from './change-password-form'

export const dynamic = 'force-dynamic'

export default function AccountSettingsPage() {
  return (
    <div className="space-y-6 max-w-md">
      <div>
        <h1 className="text-2xl font-bold">내 계정</h1>
        <p className="text-sm text-muted-foreground">비밀번호 변경</p>
      </div>
      <ChangePasswordForm />
    </div>
  )
}
