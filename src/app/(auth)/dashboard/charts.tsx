'use client'

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts'

export interface DailyPoint {
  date: string // YYYY-MM-DD
  label: string // M/D
  count: number
  amount: number
}

export interface MonthlyPoint {
  month: string // YYYY-MM
  label: string // M월
  count: number
  amount: number
}

// 큰 금액을 만/억 단위로 압축 표시 (Y축 라벨용)
function formatAmountShort(v: number): string {
  if (v >= 100_000_000) return `${(v / 100_000_000).toFixed(1)}억`
  if (v >= 10_000) return `${Math.round(v / 10_000).toLocaleString('ko-KR')}만`
  return v.toLocaleString('ko-KR')
}

export function DailyOrdersChart({ data }: { data: DailyPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="#6b7280" />
        <YAxis tick={{ fontSize: 11 }} stroke="#6b7280" allowDecimals={false} />
        <Tooltip
          contentStyle={{ fontSize: 12, borderRadius: 6 }}
          labelFormatter={(l) => `${l}`}
          formatter={(v: number) => [`${v.toLocaleString('ko-KR')}건`, '주문']}
        />
        <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function MonthlyOrdersChart({ data }: { data: MonthlyPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="#6b7280" />
        <YAxis tick={{ fontSize: 11 }} stroke="#6b7280" allowDecimals={false} />
        <Tooltip
          contentStyle={{ fontSize: 12, borderRadius: 6 }}
          formatter={(v: number) => [`${v.toLocaleString('ko-KR')}건`, '주문']}
        />
        <Line
          type="monotone"
          dataKey="count"
          stroke="#10b981"
          strokeWidth={2}
          dot={{ r: 3, fill: '#10b981' }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

export function DailySalesChart({ data }: { data: DailyPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="#6b7280" />
        <YAxis
          tick={{ fontSize: 11 }}
          stroke="#6b7280"
          tickFormatter={formatAmountShort}
          width={56}
        />
        <Tooltip
          contentStyle={{ fontSize: 12, borderRadius: 6 }}
          labelFormatter={(l) => `${l}`}
          formatter={(v: number) => [`${v.toLocaleString('ko-KR')}원`, '매출']}
        />
        <Bar dataKey="amount" fill="#f59e0b" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function MonthlySalesChart({ data }: { data: MonthlyPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="#6b7280" />
        <YAxis
          tick={{ fontSize: 11 }}
          stroke="#6b7280"
          tickFormatter={formatAmountShort}
          width={56}
        />
        <Tooltip
          contentStyle={{ fontSize: 12, borderRadius: 6 }}
          formatter={(v: number) => [`${v.toLocaleString('ko-KR')}원`, '매출']}
        />
        <Line
          type="monotone"
          dataKey="amount"
          stroke="#ef4444"
          strokeWidth={2}
          dot={{ r: 3, fill: '#ef4444' }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
