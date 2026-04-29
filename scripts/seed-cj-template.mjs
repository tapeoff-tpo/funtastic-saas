/**
 * 'CJ대한통운 발주서 양식' 시드/갱신.
 * 동일 이름 양식이 있으면 columns 만 UPDATE 한다 (재실행 가능).
 *
 * 필드 매핑:
 *  - 데이터: recipientName, recipientPhone, buyerPhone, shippingAddress.address1,
 *           productName, marketplaceOrderId, quantity, optionText, logisticsMessage
 *  - 확장(export route 가 계산): senderName(쇼핑몰명), productCode(SKU),
 *           productPlusOption, collectedProductName, collectedOption,
 *           stock(현재고), location(위치)
 *  - 고정(fixedValue): senderPhone, senderAddress, boxCount, freightType, baseFreight
 */
import postgres from 'postgres'

const sql = postgres(process.env.DATABASE_URL)

const USER_ID = 'aad08ee7-a0dc-422f-8bb6-da243fe59b1b'
const TEMPLATE_NAME = 'CJ대한통운 발주서 양식'

const columns = [
  { header: '받는분성명',                  field: 'recipientName',            width: 12, required: true },
  { header: '받는분전화번호',              field: 'recipientPhone',           width: 14, required: true },
  { header: '받는분기타연락처',            field: 'buyerPhone',               width: 14, required: false },
  { header: '받는분주소(전체? 분할)',      field: 'shippingAddress.address1', width: 40, required: true },
  { header: '상품명',                      field: 'productName',              width: 30, required: true },
  { header: '박스수량',                    field: 'boxCount',                 width: 8,  required: false, fixedValue: '1' },
  { header: '운임구분',                    field: 'freightType',              width: 8,  required: false, fixedValue: '3' },
  { header: '기본운임',                    field: 'baseFreight',              width: 10, required: false, fixedValue: '1850' },
  { header: '배송메세지',                  field: 'shippingMessage',          width: 20, required: false },
  { header: '고객주문번호',                field: 'marketplaceOrderId',       width: 16, required: false },
  { header: '내품수량',                    field: 'quantity',                 width: 8,  required: true },
  { header: '내품명',                      field: 'optionText',               width: 20, required: false },
  { header: '보내는분성명',                field: 'senderName',               width: 12, required: false },
  { header: '보내는분전화번호',            field: 'senderPhone',              width: 14, required: false, fixedValue: '070-7525-7771' },
  { header: '보내는분주소(전체? 분할)',    field: 'senderAddress',            width: 40, required: false, fixedValue: '경기 광주시 직동로 8(직동) 물류창고' },
  { header: '상품코드',                    field: 'productCode',              width: 14, required: false },
  { header: '쇼핑몰 상품코드',             field: 'marketProductCode',        width: 14, required: false },
  { header: '쇼핑몰 주문번호',             field: 'marketplaceOrderId',       width: 20, required: false },
  { header: '물류메세지',                  field: 'logisticsMessage',         width: 20, required: false },
  { header: '현재고',                      field: 'stock',                    width: 8,  required: false },
  { header: '수집상품명',                  field: 'collectedProductName',     width: 30, required: false },
  { header: '수집옵션명',                  field: 'collectedOption',          width: 16, required: false },
  { header: '상품명+옵션',                 field: 'productPlusOption',        width: 30, required: false },
  { header: '위치',                        field: 'location',                 width: 12, required: false },
  { header: '관리자메모',                  field: 'adminMemo',                width: 12, required: false },
]

try {
  const existing = await sql`
    SELECT id FROM carrier_templates
    WHERE user_id = ${USER_ID} AND name = ${TEMPLATE_NAME}
  `
  if (existing.length > 0) {
    await sql`
      UPDATE carrier_templates
      SET columns = ${sql.json(columns)}, updated_at = now()
      WHERE id = ${existing[0].id}
    `
    console.log('갱신:', existing[0].id)
  } else {
    const [row] = await sql`
      INSERT INTO carrier_templates (user_id, carrier_id, name, columns, is_default)
      VALUES (${USER_ID}, 'CJGLS', ${TEMPLATE_NAME}, ${sql.json(columns)}, false)
      RETURNING id, name
    `
    console.log('생성:', row)
  }
} catch (e) {
  console.error('ERR:', e)
  process.exit(1)
}
await sql.end()
