/**
 * Korean carrier code registry with per-marketplace mapping.
 *
 * Contains all 14 major Korean carriers and provides
 * utility functions for name lookup and marketplace-specific
 * code translation.
 */

import type { CarrierInfo } from './types'

/** All supported Korean carriers */
export const CARRIERS: CarrierInfo[] = [
  { code: 'CJGLS', koreanName: 'CJ대한통운', englishName: 'CJ Logistics' },
  { code: 'HANJIN', koreanName: '한진택배', englishName: 'Hanjin Express' },
  { code: 'HYUNDAI', koreanName: '현대택배', englishName: 'Hyundai Logistics' },
  { code: 'EPOST', koreanName: '우체국택배', englishName: 'Korea Post' },
  { code: 'KGB', koreanName: '로젠택배', englishName: 'Logen' },
  { code: 'KDEXP', koreanName: '경동택배', englishName: 'Kyungdong Express' },
  { code: 'CHUNIL', koreanName: '천일택배', englishName: 'Chunil Express' },
  { code: 'DAESIN', koreanName: '대신택배', englishName: 'Daesin Express' },
  { code: 'ILYANG', koreanName: '일양로지스', englishName: 'Ilyang Logis' },
  { code: 'CVSNET', koreanName: 'CVSnet편의점택배', englishName: 'CVSnet' },
  { code: 'REGISTPOST', koreanName: '우편등기', englishName: 'Registered Mail' },
  { code: 'HDEXP', koreanName: '합동택배', englishName: 'HD Express' },
  { code: 'HONAM', koreanName: '호남택배', englishName: 'Honam Express' },
  { code: 'ETC', koreanName: '기타택배', englishName: 'Others' },
]

/** Primary carriers used for default templates (per D-10) */
export const PRIMARY_CARRIERS = ['CJGLS', 'HANJIN', 'HYUNDAI', 'EPOST', 'KGB'] as const

/** Carrier lookup map for O(1) access */
const carrierMap = new Map<string, CarrierInfo>(
  CARRIERS.map((c) => [c.code, c]),
)

/**
 * Get Korean name for a carrier code.
 * Returns the code itself if not found.
 */
export function getCarrierName(code: string): string {
  return carrierMap.get(code)?.koreanName ?? code
}

/**
 * Per-marketplace carrier code overrides.
 * Currently identity mapping -- Korean marketplace APIs use
 * the same carrier codes. Structure allows future overrides.
 */
const MARKETPLACE_CODE_OVERRIDES: Record<string, Record<string, string>> = {
  // Example: if coupang used a different code for CJ:
  // coupang: { CJGLS: 'CJGLS_COUPANG' },
  gmarket: {
    CJGLS: '10013',
    HANJIN: '10007',
    HYUNDAI: '10008',
    EPOST: '10005',
    KGB: '10003',
    KDEXP: '10016',
    CHUNIL: '10017',
    DAESIN: '10014',
    ILYANG: '10015',
    ETC: '10034',
  },
  auction: {
    CJGLS: '10013',
    HANJIN: '10007',
    HYUNDAI: '10008',
    EPOST: '10005',
    KGB: '10003',
    KDEXP: '10016',
    CHUNIL: '10017',
    DAESIN: '10014',
    ILYANG: '10015',
    ETC: '10070',
  },
  domechango: {
    CJGLS: '4',
    HANJIN: '12',
    HYUNDAI: '13',
    EPOST: '9',
    KGB: '5',
    KDEXP: '39',
    CHUNIL: '19',
    DAESIN: '33',
    ILYANG: '22',
    HDEXP: '41',
    HONAM: '102',
    ETC: '24',
  },
  ownerclan: {
    CJGLS: '3',
    KDEXP: '24',
  },
}

/**
 * Map internal carrier code to marketplace-specific code.
 * Falls back to identity mapping if no override exists.
 */
export function mapCarrierCode(marketplaceId: string, internalCode: string): string {
  return MARKETPLACE_CODE_OVERRIDES[marketplaceId]?.[internalCode] ?? internalCode
}
