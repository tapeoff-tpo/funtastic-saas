/**
 * 엑셀 양식 관리 페이지.
 *
 * 택배사 종속을 제거 — 자유 양식(name + columns)만으로 정의된다.
 * 기존에 carrier_id 가 채워진 양식도 그대로 표시되지만 신규는 NULL.
 */

import {
  getCarrierTemplateById,
  getCarrierTemplates,
  deleteCarrierTemplate,
  createCarrierTemplate,
  updateCarrierTemplate,
} from '@/lib/shipping/template-queries'
import { AVAILABLE_ORDER_FIELDS } from '@/lib/shipping/excel/templates'
import type { CarrierTemplateColumn } from '@/lib/shipping/types'
import type { Metadata } from 'next'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { TemplateClient } from './client'
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'

export const metadata: Metadata = {
  title: '엑셀 양식 관리',
}

interface PageProps {
  searchParams: Promise<{ edit?: string }>
}

export default async function TemplatesPage({ searchParams }: PageProps) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const userId = await getWorkspaceUserId(user.id)
  const { edit: editId } = await searchParams
  const templates = await getCarrierTemplates(userId)
  const editing = editId ? await getCarrierTemplateById(editId) : null

  async function handleDelete(formData: FormData) {
    'use server'
    const templateId = formData.get('templateId') as string
    if (templateId) {
      await deleteCarrierTemplate(templateId)
      revalidatePath('/shipping/templates')
    }
  }

  async function handleCreate(formData: FormData) {
    'use server'
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const workspaceUserId = await getWorkspaceUserId(user.id)
    const name = formData.get('name') as string
    const columnsJson = formData.get('columns') as string

    if (!name || !columnsJson) return

    const columns = JSON.parse(columnsJson) as CarrierTemplateColumn[]
    await createCarrierTemplate({
      userId: workspaceUserId,
      carrierId: null,
      name,
      columns,
      isDefault: false,
    })
    revalidatePath('/shipping/templates')
  }

  async function handleUpdate(formData: FormData) {
    'use server'
    const templateId = formData.get('templateId') as string
    const name = formData.get('name') as string
    const columnsJson = formData.get('columns') as string

    if (!templateId || !columnsJson) return

    const columns = JSON.parse(columnsJson) as CarrierTemplateColumn[]
    await updateCarrierTemplate(templateId, {
      ...(name ? { name } : {}),
      columns,
    })
    revalidatePath('/shipping/templates')
    redirect('/shipping/templates')
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">엑셀 양식 관리</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          주문 엑셀 다운로드용 양식을 자유롭게 만들고 관리합니다. 헤더 텍스트와 너비를 원하는 대로 지정하세요.
        </p>
      </div>

      {templates.length === 0 ? (
        <div className="rounded-md border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
          등록된 양식이 없습니다. 아래 [새 양식 만들기] 버튼으로 시작하세요.
        </div>
      ) : (
        <div className="space-y-4">
          {templates.map((template) => (
            <details
              key={template.id}
              className="group rounded-lg border bg-white open:shadow-sm"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 hover:bg-muted/30">
                <div className="flex items-center gap-2">
                  <svg
                    className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-90"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      fillRule="evenodd"
                      d="M7.21 14.77a.75.75 0 0 1 .02-1.06L10.94 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.25 4.25a.75.75 0 0 1 0 1.08l-4.25 4.25a.75.75 0 0 1-1.06-.02Z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <h3 className="font-medium">{template.name}</h3>
                  {template.carrierId && (
                    <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground" title="이 양식은 택배사에 연결됨">
                      {template.carrierId}
                    </span>
                  )}
                  {template.isDefault && (
                    <span className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700">
                      기본
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {template.columns.length}개 열
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href={`/shipping/templates?edit=${template.id}`}
                    className="rounded-md border px-3 py-1 text-xs hover:bg-muted"
                  >
                    수정
                  </a>
                  <form action={handleDelete}>
                    <input type="hidden" name="templateId" value={template.id} />
                    <button
                      type="submit"
                      className="rounded-md border border-red-300 px-3 py-1 text-xs text-red-600 hover:bg-red-50"
                    >
                      삭제
                    </button>
                  </form>
                </div>
              </summary>

              {/* Column list */}
              <div className="overflow-x-auto border-t">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-3 py-1.5 text-left font-medium">헤더</th>
                      <th className="px-3 py-1.5 text-left font-medium">출력 항목</th>
                      <th className="px-3 py-1.5 text-left font-medium">출력내용</th>
                    </tr>
                  </thead>
                  <tbody>
                    {template.columns.map((col, idx) => (
                      <tr key={idx} className="border-t">
                        <td className="px-3 py-1.5">{col.header}</td>
                        <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">
                          {col.field}
                          {col.extraFields && col.extraFields.length > 0 && (
                            <>
                              <span className="ml-1 text-emerald-700">
                                {col.extraFields.map((f) => ` + ${f}`).join('')}
                              </span>
                              <span className="ml-1 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                                구분자: {col.joinSeparator === ' ' || !col.joinSeparator ? '공백' : col.joinSeparator}
                              </span>
                            </>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-xs">
                          {col.fixedValue
                            ? <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">{col.fixedValue}</span>
                            : <span className="text-muted-foreground">자동</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ))}
        </div>
      )}

      {/* Create / edit form */}
      <TemplateClient
        availableFields={AVAILABLE_ORDER_FIELDS}
        editing={editing}
        onCreateAction={handleCreate}
        onUpdateAction={handleUpdate}
      />
    </div>
  )
}
