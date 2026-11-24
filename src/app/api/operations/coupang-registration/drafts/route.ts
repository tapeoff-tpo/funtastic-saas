import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { registrationWorkspace } from '@/lib/coupang-registration/auth'
import { draftSchema } from '@/lib/coupang-registration/schema'
import { checkedLabel, readTemplate } from '@/lib/coupang-registration/excel'
import { listDrafts, loadDraft, saveDraft } from '@/lib/coupang-registration/store'
import { prepareDraftSave } from '@/lib/coupang-registration/draft-workflow'

export const runtime = 'nodejs'
export async function GET(request: NextRequest) {
  const workspace = await registrationWorkspace()
  if (!workspace) return NextResponse.json({ error: '접근 권한이 없습니다.' }, { status: 403 })
  const id = request.nextUrl.searchParams.get('id')
  if (id && !z.uuid().safeParse(id).success) return NextResponse.json({ error: '작업 ID가 올바르지 않습니다.' }, { status: 400 })
  if (!id) return NextResponse.json({ drafts: await listDrafts(workspace) })
  const draft = await loadDraft(workspace, id)
  if (!draft) return NextResponse.json({ error: '저장된 작업을 찾을 수 없습니다.' }, { status: 404 })
  try {
    // Refresh only official field metadata. Saved product values and revision stay intact.
    const templates = await Promise.all(draft.payload.templates.map(async (template) => {
      if (!draft.payload.rows.some((row) => row.templateId === template.id)) return template
      const parsed = await readTemplate(Buffer.from(template.file.data, 'base64'), template.file.name)
      if (parsed.template.id !== template.id) throw new Error('저장된 카테고리 양식이 변경되었습니다. 쿠팡 최신 양식을 다시 연결해주세요.')
      return { ...template, sheets: parsed.template.sheets }
    }))
    return NextResponse.json({ ...draft, payload: { ...draft.payload, templates } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '저장된 양식을 확인하지 못했습니다.' }, { status: 400 })
  }
}

export async function POST(request: NextRequest) {
  const workspace = await registrationWorkspace()
  if (!workspace) return NextResponse.json({ error: '접근 권한이 없습니다.' }, { status: 403 })
  try {
    const text = await request.text()
    if (Buffer.byteLength(text) > 4_000_000) throw new Error('저장 용량이 4MB를 초과했습니다. 작업을 나눠 저장해주세요.')
    const parsed = z.object({ id: z.uuid().optional(), revision: z.number().int().positive().optional(), draft: draftSchema }).parse(JSON.parse(text))
    parsed.draft.labels.forEach(checkedLabel)
    const existing = parsed.id ? await loadDraft(workspace, parsed.id) : null
    if (parsed.id && (!existing || existing.revision !== parsed.revision)) return NextResponse.json({ error: '다른 사용자가 수정한 작업입니다. 최신 작업을 다시 불러와주세요.' }, { status: 409 })
    const payload = prepareDraftSave(parsed.draft, existing?.payload)
    const saved = await saveDraft(workspace, payload, parsed.id, parsed.revision)
    if (!saved) return NextResponse.json({ error: '다른 사용자가 수정한 작업입니다. 새 작업으로 저장하거나 최신 작업을 다시 불러와주세요.' }, { status: 409 })
    return NextResponse.json({ ...saved, payload })
  } catch (error) {
    console.error('Coupang registration save failed', error instanceof Error ? error.name : 'Unknown error')
    return NextResponse.json({ error: error instanceof z.ZodError ? '저장할 상품·파일 정보를 확인해주세요.' : error instanceof Error ? error.message : '저장하지 못했습니다.' }, { status: 400 })
  }
}
