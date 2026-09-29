import {
  getPersistedPurchaseHistoryBridgeKeys,
  parseEcountPurchasingSnapshot,
  summarizeEcountPurchasingSnapshot,
  syncEcountPurchasingSnapshot,
} from '../src/lib/purchasing/ecount-purchasing-sync'
import { recordDataRefresh } from '../src/lib/purchasing/data-freshness'
import { getStoredEcountRawFiles } from '../src/lib/purchasing/ecount-raw-files'

const apply = process.argv.includes('--apply')
const userId = argumentValue('--user-id')
const domesticInventoryReflectedThrough = argumentValue('--domestic-reflected-through')
const asOfDate = argumentValue('--as-of-date') ?? new Date().toISOString().slice(0, 10)

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL이 필요합니다.')
if (!userId) throw new Error('--user-id에 작업공간 사용자 ID를 입력해주세요.')
if (!domesticInventoryReflectedThrough) {
  throw new Error('--domestic-reflected-through에 국내재고 반영 기준일(YYYY-MM-DD)을 입력해주세요.')
}

async function main() {
  const [files, purchaseHistoryBridgeKeys] = await Promise.all([
    getStoredEcountRawFiles(userId),
    getPersistedPurchaseHistoryBridgeKeys(userId),
  ])
  const snapshot = await parseEcountPurchasingSnapshot({
    files,
    asOfDate,
    domesticInventoryReflectedThrough,
    purchasePlanConfirmedSince: '2026-07-01',
    allowMissingReports: true,
    purchaseHistoryBridgeKeys,
  })

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    summary: summarizeEcountPurchasingSnapshot(snapshot),
  }, null, 2))

  if (!apply) {
    console.log('읽기 전용 확인 완료. 실제 반영은 --apply를 추가하세요.')
    return
  }

  const result = await syncEcountPurchasingSnapshot({
    userId,
    requestedByUserId: userId,
    snapshot,
  })
  await recordDataRefresh({
    userId,
    source: 'purchasing_raw:chinaOutbound',
    metadata: {
      fileName: snapshot.files.chinaOutbound,
      domesticInventoryReflectedThrough,
      reprocessed: true,
    },
  })
  console.log(JSON.stringify({ result }, null, 2))
}

function argumentValue(flag: string) {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1]?.trim() || null : null
}

void main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
