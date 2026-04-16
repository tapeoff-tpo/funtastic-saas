'use client'

import type { ColumnDef } from '@tanstack/react-table'
import { Badge } from '@/components/ui/badge'
import { PRODUCT_STATUS_LABELS, type ProductStatus } from '@/lib/products/types'

/** Row shape for the product table */
export interface ProductRow {
  id: string
  internalSku: string
  name: string
  categoryId: string | null
  basePrice: string
  costPrice: string | null
  warehouseLocation: string | null
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
      <span className="font-mono text-sm">
        {row.getValue('internalSku')}
      </span>
    ),
    size: 140,
  },
  // 상품명
  {
    accessorKey: 'name',
    header: '상품명',
    cell: ({ row }) => (
      <div className="max-w-[300px] truncate" title={row.getValue('name')}>
        {row.getValue('name')}
      </div>
    ),
    size: 300,
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
    enableSorting: false,
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
  // 옵션수
  {
    accessorKey: 'variantCount',
    header: '옵션수',
    enableSorting: false,
    cell: ({ row }) => {
      const count = row.getValue('variantCount') as number
      return <span className="text-sm">{count}</span>
    },
    size: 80,
  },
]
