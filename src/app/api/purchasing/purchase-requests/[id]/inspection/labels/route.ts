import { randomBytes } from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getUserMenuAccess } from '@/lib/auth/menu-access'
import { canUseMenu } from '@/lib/auth/menu-permissions'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import {
  getInspectionLabelTarget, getUploadedInspectionLabelFile, InspectionLabelInputError, listInspectionLabelFiles,
  readInspectionLabelBody, uploadInspectionLabel,
} from '@/lib/purchasing/purchase-inspection-label-files'
import { INSPECTION_LABEL_KINDS, INSPECTION_LABEL_SOURCES, type InspectionLabelSource } from '@/lib/purchasing/purchase-inspection-label-types'

type Context = { params: Promise<{ id: string }> }
const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }

async function authorize(context: Context) {
  const user = await getCurrentUser()
  if (!user || user.mustChangePassword) return { error: NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 }) }
  const access = await getUserMenuAccess(user.id)
  if (!access || !['/purchasing/orders', '/purchasing/overdue'].some((menu) => canUseMenu(access, menu))) {
    return { error: NextResponse.json({ error: '검수 자료를 볼 권한이 없습니다.' }, { status: 403 }) }
  }
  const id = z.uuid().safeParse((await context.params).id)
  if (!id.success) return { error: NextResponse.json({ error: '발주 항목을 찾을 수 없습니다.' }, { status: 404 }) }
  const userId = await getWorkspaceUserId(user.id)
  const target = await getInspectionLabelTarget(userId, id.data)
  if (!target) return { error: NextResponse.json({ error: '발주 항목을 찾을 수 없습니다.' }, { status: 404 }) }
  return { userId, actorId: user.id, target }
}

export async function GET(request: Request, context: Context) {
  const scope = await authorize(context)
  if (scope.error) return scope.error
  const url = new URL(request.url)
  const fileId = url.searchParams.get('file')
  try {
    if (!fileId) {
      const files = await listInspectionLabelFiles(scope.userId, scope.target.sku)
      return NextResponse.json({ files: files.map(({ id, kind, source, fileName, contentType }) => ({ id, kind, source, fileName, contentType })) }, { headers: privateHeaders })
    }
    const source = z.enum(INSPECTION_LABEL_SOURCES).safeParse(url.searchParams.get('source'))
    if (!z.uuid().safeParse(fileId).success || !source.success) return new Response(null, { status: 404, headers: privateHeaders })
    const file = source.data === 'upload'
      ? await getUploadedInspectionLabelFile(scope.userId, scope.target.sku, fileId)
      : (await listInspectionLabelFiles(scope.userId, scope.target.sku)).find((entry) => entry.id === fileId && entry.source === source.data)
    if (!file) return new Response(null, { status: 404, headers: privateHeaders })
    if (url.searchParams.get('print') === '1' && file.contentType.startsWith('image/')) {
      return printLabelImage(file.id, file.source)
    }
    const body = await readInspectionLabelBody(scope.userId, file, request.signal)
    if (!body) return new Response(null, { status: 404, headers: privateHeaders })
    return new Response(body, { headers: {
      ...privateHeaders,
      'Content-Type': file.contentType,
      'Content-Length': String(file.fileSize),
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    } })
  } catch (error) {
    console.error('purchase inspection label read failed', error)
    return NextResponse.json({ error: '스티커 자료를 불러오지 못했습니다.' }, { status: 502, headers: privateHeaders })
  }
}

function printLabelImage(id: string, source: InspectionLabelSource) {
  const image = `?file=${encodeURIComponent(id)}&amp;source=${source}`
  const nonce = randomBytes(16).toString('base64')
  return new Response(`<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <title>스티커 인쇄</title>
  <style>
    @page { margin: 0 }
    body { margin: 0 }
    img { display: block; max-width: 100%; height: auto }
    @media print { button { display: none } }
  </style>
</head>
<body>
  <button type="button">인쇄</button>
  <img src="${image}" alt="스티커">
  <script nonce="${nonce}">
    const image = document.querySelector('img')
    const print = () => window.print()
    document.querySelector('button').addEventListener('click', print)
    if (image.complete && image.naturalWidth) print()
    else image.addEventListener('load', print, { once: true })
  </script>
</body>
</html>`, {
    headers: {
      ...privateHeaders, 'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': `default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; frame-ancestors 'none'`,
    },
  })
}

export async function POST(request: Request, context: Context) {
  const scope = await authorize(context)
  if (scope.error) return scope.error
  if (!['purchase_completed', 'inspecting', 'china_arrived'].includes(scope.target.status)) {
    return NextResponse.json({ error: '검수에서 스티커 자료를 등록해주세요.' }, { status: 409 })
  }
  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  const kind = z.enum(INSPECTION_LABEL_KINDS).safeParse(form?.get('kind'))
  if (!(file instanceof File) || !kind.success) {
    return NextResponse.json({ error: '스티커 종류와 파일을 선택해주세요.' }, { status: 400 })
  }
  try {
    const saved = await uploadInspectionLabel({ userId: scope.userId, actorId: scope.actorId, sku: scope.target.sku, kind: kind.data, file })
    return NextResponse.json({ file: saved }, { status: 201, headers: privateHeaders })
  } catch (error) {
    if (error instanceof InspectionLabelInputError) return NextResponse.json({ error: error.message }, { status: 400 })
    console.error('purchase inspection label upload failed', error)
    return NextResponse.json({ error: '스티커 자료를 저장하지 못했습니다.' }, { status: 502 })
  }
}
