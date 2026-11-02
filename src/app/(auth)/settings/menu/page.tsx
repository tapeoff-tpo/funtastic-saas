import type { Metadata } from 'next'
import { MenuOrderSettings } from './menu-order-settings'

export const metadata: Metadata = {
  title: '메뉴 설정',
}

export default function MenuSettingsPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">메뉴</h1>
      </div>
      <MenuOrderSettings />
    </div>
  )
}
