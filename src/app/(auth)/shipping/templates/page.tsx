/**
 * Carrier template management page.
 *
 * Lists existing carrier templates, allows creating/editing/deleting,
 * and seeding default templates.
 */

import {
  getCarrierTemplates,
  seedDefaultTemplates,
  deleteCarrierTemplate,
  createCarrierTemplate,
  updateCarrierTemplate,
} from '@/lib/shipping/template-queries'
import { AVAILABLE_ORDER_FIELDS } from '@/lib/shipping/excel/templates'
import { CARRIERS } from '@/lib/shipping/carrier-codes'
import type { CarrierTemplateColumn } from '@/lib/shipping/types'
import type { Metadata } from 'next'
import { revalidatePath } from 'next/cache'
import { TemplateClient } from './client'

export const metadata: Metadata = {
  title: '택배사 양식 관리',
}

export default async function TemplatesPage() {
  // TODO: Get userId from auth session
  const userId = 'placeholder-user-id'

  const templates = await getCarrierTemplates(userId)

  async function handleSeedDefaults() {
    'use server'
    await seedDefaultTemplates('placeholder-user-id')
    revalidatePath('/shipping/templates')
  }

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
    const carrierId = formData.get('carrierId') as string
    const name = formData.get('name') as string
    const columnsJson = formData.get('columns') as string

    if (!carrierId || !name || !columnsJson) return

    const columns = JSON.parse(columnsJson) as CarrierTemplateColumn[]
    await createCarrierTemplate({
      userId: 'placeholder-user-id',
      carrierId,
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
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">택배사 양식 관리</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            엑셀 내보내기용 택배사별 열 레이아웃을 관리합니다
          </p>
        </div>
        <form action={handleSeedDefaults}>
          <button
            type="submit"
            className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            기본 양식 초기화
          </button>
        </form>
      </div>

      {templates.length === 0 ? (
        <div className="rounded-md border p-8 text-center text-muted-foreground">
          등록된 양식이 없습니다. "기본 양식 초기화"를 클릭하세요.
        </div>
      ) : (
        <div className="space-y-4">
          {templates.map((template) => (
            <div key={template.id} className="rounded-lg border bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium">{template.name}</h3>
                  <span className="rounded bg-muted px-2 py-0.5 text-xs">
                    {template.carrierId}
                  </span>
                  {template.isDefault && (
                    <span className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700">
                      기본
                    </span>
                  )}
                </div>
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

              {/* Column list */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-3 py-1.5 text-left font-medium">헤더</th>
                      <th className="px-3 py-1.5 text-left font-medium">필드</th>
                      <th className="px-3 py-1.5 text-left font-medium">너비</th>
                      <th className="px-3 py-1.5 text-left font-medium">필수</th>
                    </tr>
                  </thead>
                  <tbody>
                    {template.columns.map((col, idx) => (
                      <tr key={idx} className="border-t">
                        <td className="px-3 py-1.5">{col.header}</td>
                        <td className="px-3 py-1.5 font-mono text-xs">{col.field}</td>
                        <td className="px-3 py-1.5">{col.width}</td>
                        <td className="px-3 py-1.5">{col.required ? 'Y' : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create new template */}
      <TemplateClient
        carriers={CARRIERS.map((c) => ({ code: c.code, name: c.koreanName }))}
        availableFields={AVAILABLE_ORDER_FIELDS}
        onCreateAction={handleCreate}
        onUpdateAction={handleUpdate}
      />
    </div>
  )
}
