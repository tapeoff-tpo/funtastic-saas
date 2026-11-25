import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { registrationWorkspace } from '@/lib/coupang-registration/auth'
import { getCategoryContext } from '@/lib/coupang-registration/category-context'
import { readTemplate } from '@/lib/coupang-registration/excel'
import { listSheetMappings, mappedSheetName, saveSheetMapping, sheetMappingCode, type StoredSheetMapping } from '@/lib/coupang-registration/sheet-mappings'

export const runtime = 'nodejs'
export const maxDuration = 60

const headers = { 'Cache-Control': 'private, no-store' }
const selectionSchema = z.object({
  sourceCode: sheetMappingCode.optional(),
  sourceCodes: z.array(sheetMappingCode).min(1).max(30).optional(),
  targetSheetName: mappedSheetName,
  file: z.object({
    name: z.string().min(1).max(250).regex(/\.xlsx$/i).refine(value => !/[\\/]/.test(value)),
    data: z.string().min(4).max(4_000_000).regex(/^[A-Za-z0-9+/]+={0,2}$/),
  }).strict(),
}).strict().refine(value => (value.sourceCode !== undefined) !== (value.sourceCodes !== undefined))

export async function GET(request: NextRequest) {
  const workspace = await registrationWorkspace()
  if (!workspace) return NextResponse.json({ error: '접근 권한이 없습니다.' }, { status: 403, headers })
  const sourceCode = request.nextUrl.searchParams.get('code') ?? undefined
  if (sourceCode !== undefined && !sheetMappingCode.safeParse(sourceCode).success) return NextResponse.json({ error: 'B2B 상품 코드를 확인해주세요.' }, { status: 400, headers })
  try {
    return NextResponse.json({ mappings: await listSheetMappings(workspace, sourceCode) }, { headers })
  } catch {
    return NextResponse.json({ error: '저장된 카테고리 연결을 불러오지 못했습니다.' }, { status: 500, headers })
  }
}

export async function POST(request: NextRequest) {
  const workspace = await registrationWorkspace()
  if (!workspace) return NextResponse.json({ error: '접근 권한이 없습니다.' }, { status: 403, headers })
  let selection: z.infer<typeof selectionSchema>
  try {
    const text = await request.text()
    if (Buffer.byteLength(text) > 4_000_000) throw new Error('카테고리 연결 요청은 4MB까지 저장할 수 있습니다.')
    selection = selectionSchema.parse(JSON.parse(text))
    const bytes = Buffer.from(selection.file.data, 'base64')
    if (!bytes.length || bytes.length > 3_000_000 || bytes.toString('base64') !== selection.file.data) throw new Error('3MB 이하의 원본 카테고리 엑셀 파일을 확인해주세요.')
    // Reparse the original workbook instead of trusting a client-provided sheet list.
    const { template } = await readTemplate(bytes, selection.file.name)
    if (!template.sheets.some(sheet => sheet.name === selection.targetSheetName)) throw new Error('원본 엑셀에서 선택한 카테고리 시트를 찾지 못했습니다.')
  } catch (error) {
    return NextResponse.json({ error: error instanceof z.ZodError || error instanceof SyntaxError ? '저장할 상품 코드와 원본 엑셀 시트를 확인해주세요.' : error instanceof Error ? error.message : '카테고리 연결 정보를 확인해주세요.' }, { status: 400, headers })
  }
  async function saveSource(sourceCode: string): Promise<{ mapping: StoredSheetMapping } | { failure: { sourceCode: string; error: string }; status: 500 | 502 }> {
    let context: Awaited<ReturnType<typeof getCategoryContext>>
    try {
      context = await getCategoryContext(sourceCode)
    } catch {
      return { failure: { sourceCode, error: '현재 B2B 상품 분류를 확인하지 못해 연결을 저장하지 않았습니다.' }, status: 502 }
    }
    try {
      const mapping = await saveSheetMapping(workspace!, {
        sourceCode,
        sourceCategoryName: context.categoryName,
        sourceCategoryPath: context.categoryPath,
        targetSheetName: selection.targetSheetName,
      })
      return { mapping }
    } catch {
      return { failure: { sourceCode, error: '카테고리 연결을 저장하지 못했습니다.' }, status: 500 }
    }
  }
  if (selection.sourceCode !== undefined) {
    const result = await saveSource(selection.sourceCode)
    return 'mapping' in result ? NextResponse.json({ mapping: result.mapping }, { headers })
      : NextResponse.json({ error: result.failure.error }, { status: result.status, headers })
  }
  const results: Awaited<ReturnType<typeof saveSource>>[] = []
  const sourceCodes = [...new Set(selection.sourceCodes!)]
  for (let start = 0; start < sourceCodes.length; start += 4) {
    results.push(...await Promise.all(sourceCodes.slice(start, start + 4).map(saveSource)))
  }
  return NextResponse.json({
    mappings: results.flatMap(result => 'mapping' in result ? [result.mapping] : []),
    failures: results.flatMap(result => 'failure' in result ? [result.failure] : []),
  }, { headers })
}
