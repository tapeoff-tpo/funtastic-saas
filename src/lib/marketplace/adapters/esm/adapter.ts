/**
 * ESM Trading API marketplace adapter implementing MarketplaceAdapter.
 *
 * A single adapter class that serves both Gmarket and Auction via the
 * unified ESM Trading API at sa2.esmplus.com. Instances are
 * differentiated by site_type: 'G' (Gmarket) or 'A' (Auction).
 */

import type {
  MarketplaceAdapter,
  MarketplaceConfig,
  MarketplaceCredentials,
  NormalizedOrder,
  NormalizedClaim,
  NormalizedProduct,
  InvoiceData,
} from '../../types'
import { MarketplaceApiError, MarketplaceAuthError } from '../../errors'
import { createEsmClient } from './client'
import { mapEsmStatus, mapEsmClaimStatus, mapEsmClaimType } from './status-map'
import { mapCarrierCode } from '@/lib/shipping/carrier-codes'
import type {
  EsmSiteType,
  EsmApiResponse,
  EsmOrderListData,
  EsmOrder,
  EsmClaim,
  EsmProduct,
} from './types'

function formatDate(date: Date): string {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function formatDateTime(date: Date): string {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const mi = String(date.getMinutes()).padStart(2, '0')
  const ss = String(date.getSeconds()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}`
}

function asNumber(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Number(value.replaceAll(',', ''))
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function esmOk(response: EsmApiResponse<unknown>): boolean {
  const resultCode = response.resultCode ?? response.ResultCode
  return resultCode === 0 || resultCode === '0' || resultCode === 'OK' || resultCode === 'Success'
}

function esmMessage(response: EsmApiResponse<unknown>, fallback: string): string {
  return response.resultMessage ?? response.Message ?? fallback
}

function buildEsmConfig(siteType: EsmSiteType): MarketplaceConfig {
  if (siteType === 'G') {
    return {
      id: 'gmarket',
      name: '지마켓',
      authType: 'api_key',
      rateLimitPerSecond: 30,
      requiredCredentials: ['master_id', 'secret_key', 'seller_id'],
    }
  }
  return {
    id: 'auction',
    name: '옥션',
    authType: 'api_key',
    rateLimitPerSecond: 30,
    requiredCredentials: ['master_id', 'secret_key', 'seller_id'],
  }
}

export class EsmAdapter implements MarketplaceAdapter {
  readonly config: MarketplaceConfig

  private readonly client: ReturnType<typeof createEsmClient>
  private readonly siteType: EsmSiteType

  constructor(credentials: { master_id: string; secret_key: string; seller_id: string; site_type: EsmSiteType }) {
    this.siteType = credentials.site_type
    this.config = buildEsmConfig(this.siteType)
    this.client = createEsmClient(credentials)
  }

  async testConnection(_credentials?: MarketplaceCredentials): Promise<{ success: boolean; error?: string; expiresAt?: Date }> {
    try {
      // Keep credential checks away from order endpoints. Some marketplaces
      // mutate order state during "new order" reads.
      await this.client.get('item/v1/shipping/delivery-company').json()

      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  }

  async authenticate(): Promise<{ success: boolean; expiresAt?: Date }> {
    // API key auth has no separate authentication flow
    return { success: true }
  }

  async getOrders(since: Date, until: Date = new Date()): Promise<NormalizedOrder[]> {
    try {
      const response = await this.client.post('shipping/v1/Order/RequestOrders', {
        json: {
          siteType: this.siteType === 'A' ? 1 : 2,
          orderStatus: 1,
          requestDateType: 2,
          requestDateFrom: formatDate(since),
          requestDateTo: formatDate(until),
          pageIndex: 1,
          pageSize: 1000,
        },
      }).json<EsmApiResponse<EsmOrderListData>>()

      if (!esmOk(response)) {
        throw new MarketplaceApiError(this.config.id, 500, esmMessage(response, 'ESM order API failed'))
      }

      const data = response.data ?? response.Data
      return (data?.RequestOrders ?? []).map((order) => this.normalizeOrder(order))
    } catch (error) {
      if (error instanceof MarketplaceApiError) throw error
      if (error instanceof Error && (error.message.includes('401') || error.message.includes('403'))) {
        throw new MarketplaceAuthError(this.config.id, 'API key authentication failed')
      }
      throw new MarketplaceApiError(this.config.id, 500, error instanceof Error ? error.message : 'Unknown error')
    }
  }

  async getClaimsOrders(since: Date): Promise<NormalizedClaim[]> {
    void since
    return []
  }

  async uploadInvoice(orderId: string, invoice: InvoiceData): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await this.client.post('shipping/v1/Delivery/ShippingInfo', {
        json: {
          OrderNo: Number(orderId),
          ShippingDate: formatDateTime(new Date()),
          DeliveryCompanyCode: Number(mapCarrierCode(this.config.id, invoice.carrierId)),
          InvoiceNo: invoice.trackingNumber,
        },
      }).json<EsmApiResponse<null>>()

      if (esmOk(response)) {
        return { success: true }
      }

      return { success: false, error: esmMessage(response, `Upload failed with code: ${response.resultCode ?? response.ResultCode}`) }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  async confirmOrder(
    marketplaceOrderId: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await this.client.post(`shipping/v1/Order/OrderCheck/${encodeURIComponent(marketplaceOrderId)}`, {
        json: {},
      }).json<EsmApiResponse<{ IsChanged?: number } | null>>()

      if (esmOk(response) || esmMessage(response, '').includes('이미 주문확인 처리된 건')) {
        return { success: true }
      }

      return { success: false, error: esmMessage(response, 'Order confirmation failed') }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }
  async getProducts(): Promise<NormalizedProduct[]> {
    try {
      const response = await this.client.get('api/v1/products', {
        searchParams: {
          siteType: this.siteType,
          pageSize: 100,
        },
      }).json<EsmApiResponse<EsmProduct[]>>()

      if (response.resultCode !== '0' && response.resultCode !== 'OK') {
        throw new MarketplaceApiError(this.config.id, 500, response.resultMessage)
      }

      return (response.data || []).map((product) => this.normalizeProduct(product))
    } catch (error) {
      if (error instanceof MarketplaceApiError) throw error
      if (error instanceof Error && (error.message.includes('401') || error.message.includes('403'))) {
        throw new MarketplaceAuthError(this.config.id, 'API key authentication failed')
      }
      throw new MarketplaceApiError(this.config.id, 500, error instanceof Error ? error.message : 'Unknown error')
    }
  }

  async registerProduct(product: NormalizedProduct): Promise<{ success: boolean; marketplaceProductId?: string; error?: string }> {
    try {
      const response = await this.client.post('api/v1/products', {
        json: {
          siteType: this.siteType,
          itemName: product.name,
          sellPrice: product.price,
          description: product.description || '',
          categoryCode: product.marketplaceCategoryId ?? product.categoryId,
          sellerItemCode: product.sku,
        },
      }).json<EsmApiResponse<{ itemNo: string }>>()

      if (response.resultCode === '0' || response.resultCode === 'OK') {
        return {
          success: true,
          marketplaceProductId: response.data?.itemNo,
        }
      }

      return { success: false, error: response.resultMessage || 'Registration failed' }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  async updateProduct(marketplaceProductId: string, product: Partial<NormalizedProduct>): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await this.client.put(`api/v1/products/${marketplaceProductId}`, {
        json: {
          siteType: this.siteType,
          itemName: product.name,
          sellPrice: product.price,
          description: product.description || '',
          categoryCode: product.marketplaceCategoryId ?? product.categoryId,
        },
      }).json<EsmApiResponse<null>>()

      if (response.resultCode === '0' || response.resultCode === 'OK') {
        return { success: true }
      }

      return { success: false, error: response.resultMessage || 'Update failed' }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  private normalizeOrder(order: EsmOrder): NormalizedOrder {
    const orderNo = String(order.orderNo ?? order.OrderNo ?? '')
    const orderItemSeq = String(order.orderItemSeq ?? order.OrderSeqNo ?? orderNo)
    const orderStatus = String(order.orderStatus ?? order.OrderStatus ?? '1')
    const quantity = asNumber(order.orderQty ?? order.OrderQty ?? order.ContrAmount) || 1
    const unitPrice = asNumber(order.sellPrice ?? order.SellPrice ?? order.SalePrice ?? order.BuyerPayAmt)
    const optionText = order.optionInfo
      ?? order.OptionInfo
      ?? order.ItemOptionSelectList?.map((option) => option.ItemOptionValue).filter(Boolean).join(' / ')
      ?? undefined

    return {
      marketplaceOrderId: orderNo,
      marketplaceId: this.config.id,
      marketplaceStatus: orderStatus,
      status: mapEsmStatus(orderStatus),
      buyerName: order.buyerName ?? order.BuyerName ?? 'ESM 구매자',
      buyerPhone: order.buyerPhone ?? order.BuyerMobileTel ?? order.BuyerTel ?? order.BuyerTelNo ?? undefined,
      recipientName: order.receiverName ?? order.ReceiverName ?? order.buyerName ?? order.BuyerName ?? 'ESM 수령인',
      recipientPhone: order.receiverPhone ?? order.HpNo ?? order.TelNo ?? order.ReceiverTelNo ?? undefined,
      shippingAddress: {
        zipCode: order.receiverZipcode ?? order.ZipCode ?? '',
        address1: order.receiverAddress ?? order.DelFrontAddress ?? order.DelFullAddress ?? order.Address ?? '',
        address2: order.receiverAddressDetail ?? order.DelBackAddress ?? order.AddressDetail ?? undefined,
      },
      items: [
        {
          marketplaceItemId: orderItemSeq,
          productName: order.itemName ?? order.GoodsName ?? 'ESM 상품',
          optionText,
          quantity,
          unitPrice,
          sku: order.sellerItemCode ?? order.OutGoodsNo ?? order.SellerCustNo ?? order.SiteGoodsNo ?? undefined,
        },
      ],
      orderedAt: new Date(order.orderDate ?? order.OrderDate ?? order.PayDate ?? new Date()),
      totalAmount: asNumber(order.payAmount ?? order.AcntMoney ?? order.BuyerPayAmt ?? order.OrderAmount) || quantity * unitPrice,
      shippingFee: asNumber(order.ShippingFee) || null,
      deliveryMessage: order.DelMemo ?? null,
      rawData: order as unknown as Record<string, unknown>,
    }
  }
  private normalizeClaim(claim: EsmClaim): NormalizedClaim {
    return {
      marketplaceClaimId: claim.claimNo,
      marketplaceId: this.config.id,
      marketplaceOrderId: claim.orderNo,
      claimType: mapEsmClaimType(claim.claimType),
      claimStatus: mapEsmClaimStatus(claim.claimStatus),
      reason: claim.claimReason || undefined,
      requestedAt: new Date(claim.claimDate),
      rawData: claim as unknown as Record<string, unknown>,
    }
  }

  private normalizeProduct(product: EsmProduct): NormalizedProduct {
    const images: { url: string; sortOrder: number }[] = []
    if (product.imageUrl) {
      images.push({ url: product.imageUrl, sortOrder: 0 })
    }

    const variants = (product.options || []).map((opt) => ({
      sku: opt.sellerItemCode || '',
      optionName: `${opt.optionName}: ${opt.optionValue}`,
      optionValues: { [opt.optionName]: opt.optionValue },
      price: opt.optionPrice,
      isActive: opt.stockQty > 0,
    }))

    return {
      productId: product.itemNo,
      marketplaceId: this.config.id,
      name: product.itemName,
      description: undefined,
      price: product.sellPrice,
      sku: product.sellerItemCode || product.itemNo,
      images,
      categoryId: product.categoryCode || undefined,
      categoryName: product.categoryName || undefined,
      variants,
      status: product.itemStatus,
      rawData: product as unknown as Record<string, unknown>,
    }
  }
}
