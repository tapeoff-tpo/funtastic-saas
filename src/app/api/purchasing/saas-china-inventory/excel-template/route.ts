import { NextResponse } from 'next/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getCurrentUser } from '@/lib/auth/current-user'
import {
  exportSaasChinaInventoryTemplateWorkbook,
  saasChinaInventoryTemplateFilename,
} from '@/lib/purchasing/saas-china-inventory-excel'

export const runtime = 'nodejs'

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })

  try {
    // Resolve the workspace before returning the shared template so this route
    // follows the same authentication/ownership boundary as import and export.
    await getWorkspaceUserId(user.id)
    const buffer = await exportSaasChinaInventoryTemplateWorkbook()
    return excelResponse(buffer, saasChinaInventoryTemplateFilename())
  } catch (error) {
    console.error('SaaS China inventory template export error:', error)
    return NextResponse.json({ error: 'SaaS 중국재고 업로드 양식을 만들지 못했습니다.' }, { status: 500 })
  }
}

function excelResponse(buffer: Buffer, filename: string) {
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8\'\'${encodeURIComponent(filename)}`,
    },
  })
}