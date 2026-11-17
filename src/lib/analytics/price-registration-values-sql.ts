import { sql, type SQLWrapper } from 'drizzle-orm'
import { COMMON_PRICE_KEY } from './price-registration-values'

export function numericPriceField(raw: SQLWrapper, key: string) {
  const value = sql`replace(btrim(${raw}->>${key}), ',', '')`
  return sql`CASE WHEN ${value} ~ '^[0-9]+([.][0-9]+)?$' THEN ${value}::numeric END`
}

export function commonPriceSql(raw: SQLWrapper) {
  const b2b = numericPriceField(raw, 'B2B 판매가')
  const b2c = numericPriceField(raw, 'B2C 판매가')
  return sql`COALESCE(${numericPriceField(raw, COMMON_PRICE_KEY)}, CASE
    WHEN ${b2b} IS NULL OR ${b2c} IS NULL OR ${b2b} = ${b2c} THEN COALESCE(${b2b}, ${b2c})
  END)`
}
