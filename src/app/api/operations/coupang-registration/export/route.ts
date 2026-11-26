import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { registrationWorkspace } from '@/lib/coupang-registration/auth'
import { draftSchema } from '@/lib/coupang-registration/schema'
import { buildRegistrationArchive, buildRegistrationDownload } from '@/lib/coupang-registration/excel'

const downloadSchema = z.object({
  draft: draftSchema,
  rowIds: z.array(z.string().min(1).max(100)).min(1).max(500).refine(ids => new Set(ids).size === ids.length).optional(),
})

export const runtime = 'nodejs'
export const maxDuration = 60
export async function POST(request: NextRequest) {
  if (!await registrationWorkspace()) return NextResponse.json({ error: '접근 권한이 없습니다.' }, { status: 403 })
  try {
    const text = await request.text()
    if (Buffer.byteLength(text) > 4_000_000) throw new Error('작업 용량이 4MB를 초과했습니다. 상품을 나눠 다운로드해주세요.')
    const value: unknown = JSON.parse(text)
    let download: { buffer: Buffer; contentType: string; fileName: string }
    if (value && typeof value === 'object' && 'draft' in value) {
      const parsed = downloadSchema.safeParse(value)
      if (!parsed.success) throw new Error('상품·파일 입력값과 다운로드할 상품을 확인해주세요.')
      download = await buildRegistrationDownload(parsed.data.draft, parsed.data.rowIds)
    } else {
      const parsed = draftSchema.safeParse(value)
      if (!parsed.success) throw new Error('상품·파일 입력값을 확인해주세요.')
      download = { buffer: await buildRegistrationArchive(parsed.data), contentType: 'application/zip', fileName: `쿠팡상품등록_${new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' })}.zip` }
    }
    return new NextResponse(new Uint8Array(download.buffer), { headers: {
      'Content-Type': download.contentType, 'Cache-Control': 'private, no-store',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(download.fileName)}`,
    } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '견적서를 만들지 못했습니다.' }, { status: 400 })
  }
}
