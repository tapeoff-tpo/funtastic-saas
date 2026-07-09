'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePathname } from 'next/navigation'

type PurchasingLanguage = 'ko' | 'zh'

const STORAGE_KEY = 'funtastic-purchasing-language'
const LANGUAGE_EVENT = 'funtastic-purchasing-language-change'

const PURCHASING_PATHS = [
  '/purchasing/china-inventory',
  '/purchasing/orders',
  '/purchasing/purchases',
  '/purchasing/overdue',
]

const EXACT_TRANSLATIONS: Record<string, string> = {
  '발주': '采购',
  '품목': '品目',
  '중국재고': '中国库存',
  '발주검토': '采购审核',
  '구매/입고지연': '购买/入库延迟',
  '검색': '搜索',
  '검색중...': '搜索中...',
  '초기화': '重置',
  '이전': '上一页',
  '다음': '下一页',
  '전체': '全部',
  '상태': '状态',
  '상품': '商品',
  '상품명': '商品名',
  '상품코드': '商品编码',
  '품목코드': '品目编码',
  '품목명': '品目名称',
  '옵션명': '选项名称',
  '옵션': '选项',
  '현재고': '当前库存',
  '합계': '合计',
  '창고': '仓库',
  '1창고': '1号仓库',
  '2창고': '2号仓库',
  '쿠팡': 'Coupang',
  '당월 출고수량': '本月出库数量',
  '3개월평균출고수량': '3个月平均出库数量',
  '최종수정날짜': '最后修改日期',
  '작업': '操作',
  '조정': '调整',
  '이력': '记录',
  '선택 다운': '下载所选',
  '일괄 다운': '批量下载',
  '엑셀 업로드': 'Excel上传',
  '엑셀 다운로드': '下载Excel',
  '재고 등록': '登记库存',
  '가용재고': '可用库存',
  '총재고': '总库存',
  '가용 재고': '可用库存',
  '총 재고': '总库存',
  '최근 입고': '最近入库',
  '최근 중국출고요청': '最近中国出库请求',
  '목록': '列表',
  '총 구매금액': '总采购金额',
  '원가 누락': '成本缺失',
  '원가 보기': '显示成本',
  '원가 닫기': '隐藏成本',
  '추천근거 보기': '显示推荐依据',
  '추천근거 닫기': '隐藏推荐依据',
  '추천근거': '推荐依据',
  '구매 정보': '购买信息',
  '담당자': '负责人',
  '상태 변경': '变更状态',
  '삭제': '删除',
  '선택 삭제': '删除所选',
  '선택': '已选',
  '건': '件',
  '총': '共',
  '주문서번호': '订单号',
  '구매방법': '购买方式',
  '개인': '个人',
  '법인': '法人',
  '직접입력': '手动输入',
  '구매수량': '购买数量',
  '중국도착수량': '中国到达数量',
  '출고요청수량': '出库请求数量',
  '요청수량': '请求数量',
  '개당 원가(元)': '单件成本(元)',
  '개당 원가(₩)': '单件成本(₩)',
  '총 원가(元)': '总成本(元)',
  '총 원가(₩)': '总成本(₩)',
  '구입관리코드': '采购管理码',
  '발주요청 날짜': '采购请求日期',
  '구매날짜': '购买日期',
  '발주요청': '采购请求',
  '구매완료': '购买完成',
  '중국창고도착': '到达中国仓库',
  '중국출고요청': '中国出库请求',
  '중국출고완료': '中国出库完成',
  '당월 출고': '本月出库',
  '3개월평균': '3个月平均',
  '목표수량': '目标数量',
  '구매 지연 확인 필요': '需要确认购买延迟',
  '도착 지연 확인 필요': '需要确认到达延迟',
  '중국창고 재고 목록': '中国仓库库存列表',
  '파일 업로드': '文件上传',
  '저장': '保存',
  '저장 중': '保存中',
  '취소': '取消',
  '닫기': '关闭',
}

const PHRASE_TRANSLATIONS: Array<[RegExp, string]> = [
  [/건입니다/g, '件'],
  [/건이 있습니다/g, '件'],
  [/총 ([\d,]+)건/g, '共 $1 件'],
  [/([\d,]+)건/g, '$1 件'],
  [/선택 ([\d,]+)건/g, '已选 $1 件'],
  [/(\d+)일 지연/g, '延迟 $1 天'],
  [/발주요청 날짜 기준 (\d+)일 경과/g, '采购请求日期起已过 $1 天'],
  [/구매날짜 기준 (\d+)일 경과/g, '购买日期起已过 $1 天'],
  [/품목코드, 상품명, 주문번호/g, '品目编码、商品名、订单号'],
  [/품목코드, 상품명, 옵션/g, '品目编码、商品名、选项'],
  [/조건에 맞는 발주 항목이 없습니다/g, '没有符合条件的采购项目'],
  [/조건에 맞는 중국창고 재고가 없습니다/g, '没有符合条件的中国仓库库存'],
  [/발주요청 날짜 기준 7일이 지난 항목/g, '采购请求日期起超过 7 天的项目'],
  [/구매날짜 기준 7일이 지난 항목/g, '购买日期起超过 7 天的项目'],
  [/발주요청 지연/g, '采购请求延迟'],
  [/구매완료 입고지연/g, '购买完成后入库延迟'],
  [/원가 누락: 元/g, '成本缺失: 元'],
  [/예산 조정/g, '预算调整'],
  [/급증 제외 적용평균/g, '排除暴增后的适用平均值'],
  [/페이지/g, '页'],
  [/년/g, '年'],
  [/월/g, '月'],
  [/이하/g, '以下'],
  [/로 이동/g, '移动'],
]

const ATTRIBUTE_NAMES = ['placeholder', 'title', 'aria-label'] as const
const TRANSLATABLE_ELEMENT_SELECTOR = [
  'h1',
  'h2',
  'h3',
  'th',
  'nav',
  'button',
  'a',
  'label',
  'strong',
  '[role="tab"]',
  '[aria-label]',
].join(',')

const SAFE_INLINE_LABELS = new Set([
  '발주',
  '품목',
  '중국재고',
  '발주검토',
  '구매/입고지연',
  '발주요청',
  '구매완료',
  '중국창고도착',
  '중국출고요청',
  '중국출고완료',
  '구매 지연 확인 필요',
  '도착 지연 확인 필요',
])

const SAFE_INLINE_PATTERNS = [
  /발주요청 지연 [\d,]+건/,
  /구매완료 입고지연 [\d,]+건/,
]

const textOriginals = new WeakMap<Text, string>()
const attrOriginals = new WeakMap<Element, Map<string, string>>()

function isPurchasingPath(pathname: string | null) {
  if (!pathname) return false
  return PURCHASING_PATHS.includes(pathname)
}

function readLanguage(): PurchasingLanguage {
  if (typeof window === 'undefined') return 'ko'
  return window.localStorage.getItem(STORAGE_KEY) === 'zh' ? 'zh' : 'ko'
}

function translateText(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return value

  const exact = EXACT_TRANSLATIONS[trimmed]
  if (exact) return value.replace(trimmed, exact)

  let translated = value
  for (const [pattern, replacement] of PHRASE_TRANSLATIONS) {
    translated = translated.replace(pattern, replacement)
  }
  return translated
}

function shouldSkip(node: Node) {
  const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement
  return Boolean(element?.closest('[data-no-translate], [data-purchasing-language-control]'))
}

function shouldTranslateNode(node: Node, original: string) {
  const trimmed = original.trim()
  const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement
  if (!element || !trimmed) return false
  if (SAFE_INLINE_LABELS.has(trimmed)) return true
  if (SAFE_INLINE_PATTERNS.some((pattern) => pattern.test(trimmed))) return true
  if (element.closest(TRANSLATABLE_ELEMENT_SELECTOR)) return true
  return false
}

function applyLanguage(root: ParentNode, language: PurchasingLanguage) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const textNodes: Text[] = []
  while (walker.nextNode()) {
    textNodes.push(walker.currentNode as Text)
  }

  for (const node of textNodes) {
    if (shouldSkip(node)) continue
    const original = textOriginals.get(node) ?? node.textContent ?? ''
    if (!textOriginals.has(node)) textOriginals.set(node, original)
    node.textContent = language === 'zh' && shouldTranslateNode(node, original) ? translateText(original) : original
  }

  const elements = root instanceof Element
    ? [root, ...Array.from(root.querySelectorAll('*'))]
    : Array.from(root.querySelectorAll('*'))

  for (const element of elements) {
    if (shouldSkip(element)) continue
    for (const attr of ATTRIBUTE_NAMES) {
      if (!element.hasAttribute(attr)) continue
      const originals = attrOriginals.get(element) ?? new Map<string, string>()
      const original = originals.get(attr) ?? element.getAttribute(attr) ?? ''
      if (!attrOriginals.has(element)) attrOriginals.set(element, originals)
      if (!originals.has(attr)) originals.set(attr, original)
      element.setAttribute(
        attr,
        language === 'zh' && shouldTranslateNode(element, original) ? translateText(original) : original,
      )
    }
  }
}

export function PurchasingLanguageSwitcher() {
  const pathname = usePathname()
  const enabled = isPurchasingPath(pathname)
  const [language, setLanguage] = useState<PurchasingLanguage>('ko')
  const [mounted, setMounted] = useState(false)
  const labels = useMemo(() => ({ ko: '한국어', zh: '中文' }), [])

  useEffect(() => {
    const initialSync = window.setTimeout(() => {
      setLanguage(readLanguage())
      setMounted(true)
    }, 0)

    function handleStorage(event: StorageEvent) {
      if (event.key === STORAGE_KEY) setLanguage(readLanguage())
    }

    function handleLanguageEvent() {
      setLanguage(readLanguage())
    }

    window.addEventListener('storage', handleStorage)
    window.addEventListener(LANGUAGE_EVENT, handleLanguageEvent)
    return () => {
      window.clearTimeout(initialSync)
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener(LANGUAGE_EVENT, handleLanguageEvent)
    }
  }, [])

  useEffect(() => {
    if (!enabled) {
      applyLanguage(document.body, 'ko')
      document.documentElement.lang = 'ko'
      return
    }

    let applying = false
    const sync = () => {
      applying = true
      applyLanguage(document.body, language)
      document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'ko'
      window.setTimeout(() => {
        applying = false
      }, 0)
    }

    sync()
    const observer = new MutationObserver(() => {
      if (!applying) sync()
    })
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...ATTRIBUTE_NAMES],
    })
    return () => observer.disconnect()
  }, [enabled, language, pathname])

  if (!enabled || !mounted) return null

  function updateLanguage(next: PurchasingLanguage) {
    window.localStorage.setItem(STORAGE_KEY, next)
    window.dispatchEvent(new Event(LANGUAGE_EVENT))
    setLanguage(next)
  }

  return (
    <div
      data-purchasing-language-control
      className="pointer-events-auto sticky top-0 z-40 mb-3 flex justify-end"
    >
      <div className="inline-flex overflow-hidden rounded-md border bg-white text-xs shadow-sm">
        {(['ko', 'zh'] as const).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => updateLanguage(item)}
            className={`px-3 py-1.5 font-medium transition-colors ${
              language === item
                ? 'bg-gray-900 text-white'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
            aria-pressed={language === item}
          >
            {labels[item]}
          </button>
        ))}
      </div>
    </div>
  )
}
