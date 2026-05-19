'use client'

import type { ColumnDef } from '@tanstack/react-table'
import { Badge } from '@/components/ui/badge'
import { PRODUCT_STATUS_LABELS, type ProductStatus } from '@/lib/products/types'

/** Row shape for the product table */
export interface ProductRow {
  id: string
  internalSku: string
  name: string
  optionName: string | null
  categoryId: string | null
  basePrice: string
  costPrice: string | null
  warehouseLocation: string | null
  defaultCarrierId: string | null
  manageInventory: boolean
  status: ProductStatus
  variantCount: number
  updatedAt: Date | string
}

/** Status badge color mapping */
const STATUS_VARIANT: Record<ProductStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  draft: 'outline',
  active: 'default',
  inactive: 'secondary',
  deleted: 'destructive',
}

export const columns: ColumnDef<ProductRow>[] = [
  // Checkbox column
  {
    id: 'select',
    header: ({ table }) => (
      <input
        type="checkbox"
        checked={table.getIsAllPageRowsSelected()}
        onChange={table.getToggleAllPageRowsSelectedHandler()}
        aria-label="전체 선택"
        className="h-4 w-4 rounded border-gray-300"
      />
    ),
    cell: ({ row }) => (
      <input
        type="checkbox"
        checked={row.getIsSelected()}
        onChange={row.getToggleSelectedHandler()}
        aria-label="행 선택"
        className="h-4 w-4 rounded border-gray-300"
      />
    ),
    enableSorting: false,
    enableHiding: false,
    size: 40,
  },
  // 상품코드
  {
    accessorKey: 'internalSku',
    header: '상품코드',
    cell: ({ row }) => (
      <a
        href={`/products/${row.original.id}`}
        className="font-mono text-sm text-blue-600 hover:underline"
      >
        {row.getValue('internalSku')}
      </a>
    ),
    size: 140,
  },
  // 상품명
  {
    accessorKey: 'name',
    header: '상품명',
    cell: ({ row }) => (
      <a
        href={`/products/${row.original.id}`}
        className="block max-w-[300px] truncate text-blue-600 hover:underline"
        title={row.getValue('name')}
      >
        {row.getValue('name')}
      </a>
    ),
    size: 300,
  },
  // 옵션명
  {
    accessorKey: 'optionName',
    header: '옵션명',
    enableSorting: false,
    cell: ({ row }) => {
      const opt = row.getValue('optionName') as string | null
      return opt ? (
        <span className="block max-w-[200px] truncate text-sm" title={opt}>{opt}</span>
      ) : (
        <span className="text-muted-foreground">-</span>
      )
    },
    size: 200,
  },
  // 카테고리
  {
    accessorKey: 'categoryId',
    header: '카테고리',
    enableSorting: false,
    cell: ({ row }) => {
      const cat = row.getValue('categoryId') as string | null
      return cat ? (
        <span className="text-sm">{cat}</span>
      ) : (
        <span className="text-muted-foreground">-</span>
      )
    },
    size: 140,
  },
  // 원가
  {
    accessorKey: 'costPrice',
    header: '원가',
    cell: ({ row }) => {
      const price = row.getValue('costPrice') as string | null
      if (!price) return <span className="text-muted-foreground">-</span>
      const num = Number(price)
      if (Number.isNaN(num)) return '-'
      return `${num.toLocaleString('ko-KR')}원`
    },
    size: 110,
  },
  // 위치
  {
    accessorKey: 'warehouseLocation',
    header: '위치',
    cell: ({ row }) => {
      const loc = row.getValue('warehouseLocation') as string | null
      return loc ? (
        <span className="text-sm">{loc}</span>
      ) : (
        <span className="text-muted-foreground">-</span>
      )
    },
    size: 100,
  },
  // 택배사
  {
    accessorKey: 'defaultCarrierId',
    header: '택배사',
    enableSorting: false,
    cell: ({ row }) => {
      const carrier = row.getValue('defaultCarrierId') as string | null
      const labels: Record<string, string> = { cj: 'CJ', kyungdong: '경동', daesin: '대신' }
      return carrier ? (
        <span className="text-sm">{labels[carrier] ?? carrier}</span>
      ) : (
        <span className="text-muted-foreground">-</span>
      )
    },
    size: 80,
  },
  // 상태
  {
    accessorKey: 'status',
    header: '상태',
    cell: ({ row }) => {
      const status = row.getValue('status') as ProductStatus
      return (
        <Badge variant={STATUS_VARIANT[status]}>
          {PRODUCT_STATUS_LABELS[status]}
        </Badge>
      )
    },
    size: 100,
  },
]
