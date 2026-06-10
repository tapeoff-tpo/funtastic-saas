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
        <p className="mt-1 text-sm text-muted-foreground">왼쪽 메뉴의 그룹과 항목 순서를 조정합니다.</p>
      </div>
      <MenuOrderSettings />
    </div>
  )
}
