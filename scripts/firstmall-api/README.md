# Funtastic B2B / Firstmall private API contract

The SaaS adapter `funtastic-b2b` expects a small private API to be uploaded to the Firstmall server.

Recommended base URL:

```text
https://funtasticb2b.co.kr/funtastic-api
```

Register this marketplace in the SaaS with:

- `api_base_url`: `https://funtasticb2b.co.kr/funtastic-api`
- `api_token`: a long random shared token

Every request must accept:

```text
Authorization: Bearer {api_token}
```

## GET /health

Response:

```json
{ "success": true }
```

## GET /orders?since=2026-05-01T00:00:00.000Z

Response:

```json
{
  "success": true,
  "orders": [
    {
      "orderId": "202605010001",
      "status": "paid",
      "buyerName": "Buyer",
      "buyerPhone": "010-0000-0000",
      "recipientName": "Receiver",
      "recipientPhone": "010-0000-0000",
      "zipCode": "12345",
      "address1": "Address line 1",
      "address2": "Address line 2",
      "orderedAt": "2026-05-01T12:34:56+09:00",
      "totalAmount": 33000,
      "deliveryMessage": "Door",
      "shippingFee": 3000,
      "items": [
        {
          "itemId": "202605010001-1",
          "productName": "Product",
          "optionText": "Option",
          "quantity": 1,
          "unitPrice": 30000,
          "sku": "SKU-001"
        }
      ]
    }
  ]
}
```

## POST /invoices

Request:

```json
{
  "orderId": "202605010001",
  "trackingNumber": "1234567890",
  "carrierId": "CJGLS"
}
```

Response:

```json
{ "success": true }
```

For the first rollout, implement `health` and `orders` first. Add `invoices` after the imported orders match Firstmall orders correctly.
