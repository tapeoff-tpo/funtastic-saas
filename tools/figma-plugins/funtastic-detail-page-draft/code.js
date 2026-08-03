const SERVER_URL = 'https://funtastic-saas-vercel.vercel.app'
const PLUGIN_VERSION = '1.1.19'
const DEFAULT_FILE_KEY = 'X8yYgVtrAFKycEA0yy0kWI'
const CANONICAL_DETAIL_PAGE_ANCHOR_ID = '390:2'
const AUTO_SYNC_INTERVAL_MS = 8_000
const IMAGE_FETCH_TIMEOUT_MS = 20_000
const IP_NOTICE_NODE_ID = '184:51'
const BRIDGE_STATE_KEY = 'funtastic-detail-page-bridge'

const COLORS = {
  ink: { r: 0.08, g: 0.09, b: 0.11 },
  muted: { r: 0.38, g: 0.4, b: 0.44 },
  paper: { r: 1, g: 1, b: 1 },
  soft: { r: 0.96, g: 0.96, b: 0.95 },
  line: { r: 0.84, g: 0.84, b: 0.82 },
  green: { r: 0.1, g: 0.32, b: 0.28 },
  mint: { r: 0.91, g: 0.96, b: 0.94 },
  amber: { r: 0.98, g: 0.74, b: 0.22 },
  red: { r: 0.72, g: 0.08, b: 0.08 },
  navy: { r: 0.06, g: 0.16, b: 0.24 },
  sky: { r: 0.89, g: 0.94, b: 0.98 },
  coral: { r: 0.9, g: 0.28, b: 0.21 },
  peach: { r: 0.99, g: 0.92, b: 0.86 },
  lavender: { r: 0.92, g: 0.91, b: 0.98 },
}

const REQUIRED_CAUTIONS = [
  '1. 용도 외 사용을 금합니다.',
  '2. 사용 전 제품이 정상적으로 작동하는지 테스트 후 사용하시기 바랍니다.',
  '3. 화기와 습기, 직사광선 등에 의해 제품의 변질 및 변색이 있을 수 있습니다.',
  '4. 충격과 급격한 온도 변화에 의한 파손에 주의해 주시기 바랍니다.',
  '5. 영유아의 손에 닿지 않도록 각별한 주의 바랍니다.',
  '6. 사용자의 부주의로 인한 제품 파손 및 피해는 교환, 반품 및 보상이 불가합니다.',
  '7. 모니터 해상도에 따라 색상이 상이할 수 있으며, 이로 인한 반품·교환은 불가합니다.',
]

const PRODUCT_BRIEFS = {
  '112313-0001': {
    targetNodeId: '244:63',
    eyebrow: 'FRONT + TOP DOUBLE DOOR',
    headline: '두 방향으로 여닫는\n반려동물 이동 켄넬',
    subhead: '앞문과 윗문, 실제 확인된 이중 개폐 구조',
    intro: '문이 한쪽에만 있으면 반려동물을 넣고 꺼내는 동선이 제한됩니다. 델토 더블도어 켄넬은 앞쪽 철제 도어와 상단 도어를 함께 확인할 수 있는 구조입니다.',
    facts: [
      ['DOUBLE DOOR', '앞문 + 윗문'],
      ['VENTILATION', '측면·상단 환기 구조'],
      ['MATERIAL', 'PP · STEEL'],
      ['SIZE', '58 × 37 × 37 cm'],
    ],
    checkpoints: [
      {
        title: '윗문을 열어 위에서도 접근',
        body: '상단 도어가 열리는 실제 공급처 구조를 확인했습니다. 급여나 상태 확인이 필요한 순간에 위쪽 접근 동선을 제공합니다.',
        image: 'https://cbu01.alicdn.com/img/ibank/O1CN01R97wM81oGjru21QMm_!!2097675198-0-cib.jpg',
        maskTop: true,
      },
      {
        title: '측면과 상단의 환기 슬롯',
        body: '공기가 통할 수 있도록 여러 면에 개방부가 배치된 외형입니다. 실제 소스에 보이는 위치와 형태만 반영했습니다.',
        image: 'https://cbu01.alicdn.com/img/ibank/O1CN01XJkN9F1oGjrtSIyak_!!2097675198-0-cib.jpg',
        maskTop: true,
      },
      {
        title: '그레이·블랙 투톤의 실제 옵션',
        body: '선택된 그레이블랙 옵션의 상부 그레이 바디와 하부 블랙 베이스, 전면 철제 도어 비율을 그대로 사용했습니다.',
        image: 'https://cbu01.alicdn.com/img/ibank/O1CN01Z8uPfA1oGjrtMviac_!!2097675198-0-cib.jpg',
        maskTop: true,
      },
    ],
    coverImage: 'https://cbu01.alicdn.com/img/ibank/O1CN01MjAmgo1oGjrt9FEmU_!!2097675198-0-cib.jpg',
    structureTitle: '선택 옵션 · 그레이블랙',
    structureBody: '상부 그레이 PP 바디, 하부 블랙 베이스, 전면 철제 도어로 확인되는 조합입니다. 다른 색상이나 다른 규격의 이미지는 섞지 않았습니다.',
    sizeParts: ['W 58 cm', 'D 37 cm', 'H 37 cm'],
    specificCautions: [
      '반려동물의 체형과 제품 내부 공간을 확인한 뒤 사용해주세요.',
      '문이 완전히 잠겼는지 확인하고 이동해주세요.',
      '도어 개폐 시 반려동물의 발과 꼬리가 끼이지 않도록 주의해주세요.',
    ],
  },
  '112350-0001': {
    targetNodeId: '245:91',
    eyebrow: 'CLEAR LARGE · ONE TIER',
    headline: '돌려서 한눈에 찾는\n투명 대형 회전 선반',
    subhead: '30.5cm 대형 원형 트레이를 360° 회전',
    intro: '안쪽 물건을 꺼내기 위해 앞의 물건부터 옮길 필요 없이, 원형 트레이를 돌려 원하는 방향을 앞으로 가져오는 구조입니다.',
    facts: [
      ['ROTATION', '360° 회전 구조'],
      ['OPTION', '투명 · 대형'],
      ['MATERIAL', 'PP'],
      ['SIZE', '30.5 × 30.5 × 10 cm'],
    ],
    checkpoints: [
      {
        title: '원형 트레이를 360° 회전',
        body: '공급처 실제 회전 장면으로 확인한 기능입니다. 원형 트레이의 방향을 바꿔 안쪽에 놓인 물건을 앞으로 가져옵니다.',
        image: 'https://cbu01.alicdn.com/img/ibank/O1CN01VWemA01TpRoCyFrKr_!!2214157892431-0-cib.jpg',
        maskBottom: true,
      },
      {
        title: '대형 옵션의 넓은 원형 수납면',
        body: '선택 옵션은 투명 대형입니다. 화장품과 병류가 함께 놓인 실제 대형 사용 장면만 사용했습니다.',
        image: 'https://cbu01.alicdn.com/img/ibank/O1CN01mwcecy1TpRo8QIXEW_!!2214157892431-0-cib.jpg',
      },
      {
        title: '한 단으로 간결한 구조',
        body: '층을 쌓은 선반이 아닌 단일 원형 트레이입니다. 투명 바디와 둘레의 벽, 중앙 회전축이 보이는 실제 구조를 기준으로 설명합니다.',
        diagram: ['ONE TIER', 'CLEAR BODY', 'ROUND TRAY'],
      },
    ],
    coverImage: 'https://cbu01.alicdn.com/img/ibank/O1CN01GzmqXA1TpRoFWCtw2_!!2214157892431-0-cib.jpg',
    options: [
      {
        name: '투명 대형',
        description: '지름 30.5cm, 높이 10cm의 단일 투명 대형 옵션입니다. 소형이나 다단형은 판매 옵션에 포함하지 않습니다.',
        image: 'https://cbu01.alicdn.com/img/ibank/O1CN01GzmqXA1TpRoFWCtw2_!!2214157892431-0-cib.jpg',
      },
    ],
    structureTitle: '선택 옵션 · 투명 대형',
    structureBody: '소형과 대형을 혼용하지 않았습니다. 직경 30.5cm, 높이 10cm로 저장된 대형 규격만 제품 정보와 사이즈 가이드에 반영했습니다.',
    sizeParts: ['W 30.5 cm', 'D 30.5 cm', 'H 10 cm'],
    specificCautions: [
      '평평하고 안정적인 곳에 놓고 사용해주세요.',
      '회전 반경에 다른 물건이 걸리지 않는지 확인해주세요.',
      '물건을 한쪽에만 치우치게 놓지 말고 균형 있게 배치해주세요.',
    ],
  },
  '112351-0001': {
    targetNodeId: '244:2',
    eyebrow: 'REFRIGERATOR ROTATING RAIL',
    headline: '냉장고 안쪽까지\n돌려서 꺼내는 레일 선반',
    subhead: '하부 레일 구조가 보이는 투명 회전 트레이',
    intro: '냉장고 선반 안쪽에 놓인 병을 찾기 위해 앞줄을 전부 꺼내지 않도록, 트레이가 레일을 따라 회전하는 실제 구조를 확인했습니다.',
    facts: [
      ['RAIL', '하부 레일 구조'],
      ['ROTATION', '360° 회전'],
      ['OPTION', '투명'],
      ['SIZE', '21.5 × 33 × 7.3 cm'],
    ],
    checkpoints: [
      {
        title: '바닥면 전체를 따라 이어진 레일',
        body: '트레이 밑면의 타원형 레일과 작은 롤러 배열을 실제 공급처 이미지로 확인했습니다. 보이지 않는 내부 기능은 추가하지 않았습니다.',
        image: 'https://cbu01.alicdn.com/img/ibank/O1CN010KMap91oZyRVoqlK6_!!4267885240-0-cib.jpg',
      },
      {
        title: '냉장고 안 실제 사용 비율',
        body: '병과 캔을 담은 냉장고 사용 장면으로 트레이의 깊이와 낮은 테두리 비율을 확인할 수 있습니다.',
        image: 'https://cbu01.alicdn.com/img/ibank/O1CN01bd89Hi1oZyRVotAyM_!!4267885240-0-cib.jpg',
      },
      {
        title: '33 × 21.5 × 7.3cm 실측 표기',
        body: '공급처 규격 이미지와 SaaS 저장값이 일치하는 것을 확인했습니다. 다른 색상 옵션은 사이즈 섹션에서 제외했습니다.',
        image: 'https://cbu01.alicdn.com/img/ibank/O1CN016mZndf1oZyRTh6xIY_!!4267885240-0-cib.jpg',
        maskTop: true,
      },
    ],
    coverImage: 'https://cbu01.alicdn.com/img/ibank/O1CN01iCFzBU1oZyRSCZYt5_!!4267885240-0-cib.jpg',
    structureTitle: '선택 옵션 · 투명',
    structureBody: '전체 투명 옵션의 실제 컷만 사용했습니다. 크림색 옵션이나 2개 세트처럼 보일 수 있는 혼합 장면은 제외했습니다.',
    sizeParts: ['W 21.5 cm', 'D 33 cm', 'H 7.3 cm'],
    specificCautions: [
      '냉장고 선반의 사용 가능 공간과 제품 규격을 먼저 확인해주세요.',
      '회전할 때 주변 용기와 간섭이 없는지 확인해주세요.',
      '무거운 용기를 한쪽에 집중해서 놓지 말아주세요.',
    ],
  },
}

Object.assign(PRODUCT_BRIEFS['112313-0001'], {
  theme: {
    dark: COLORS.navy,
    soft: COLORS.sky,
    warm: COLORS.peach,
    accent: COLORS.coral,
    accentSoft: COLORS.lavender,
  },
  eyebrow: 'FRONT + TOP DOUBLE DOOR',
  headline: '앞문과 윗문을 더한\n반려동물 더블도어 켄넬',
  subhead: '이동 전후의 케어 동선을 한결 편하게 만드는 이중 개방 구조',
  introHeading: '집에서 차까지,\n한 손으로 이어지는 이동 준비',
  intro: '반려동물을 꺼내고, 물이나 간식을 챙기고, 상태를 확인하는 순간마다 문을 여는 방향을 달리할 수 있습니다. 전면과 상단의 두 개 문을 실용적으로 나눈 이동 켄넬입니다.',
  facts: [
    ['DOUBLE DOOR', '전면 + 상단 이중 개방'],
    ['VENTILATION', '측면 + 하부 환기 슬롯'],
    ['DOOR BOWL', '앞문 전용 식기 구성'],
    ['SIZE', '58 x 37 x 37 cm'],
  ],
  options: [
    {
      name: '그레이블랙',
      description: '차분한 그레이 바디와 블랙 철제 도어를 조합한 단일 판매 옵션입니다.',
      image: `${SERVER_URL}/detail-page-assets/delto-kennel-greyblack-option-v1.jpg`,
    },
  ],
  checkpoints: [
    {
      title: '차에 싣기 전까지 이어지는 이동 동선',
      cardTitle: '출발 준비도\n차분하게',
      body: '현관에서 차량까지 옮길 때, 바닥을 안정적으로 받쳐 들고 이동하기 좋은 켄넬 형태입니다.',
      image: `${SERVER_URL}/detail-page-assets/delto-kennel-car-loading-v1.png`,
    },
    {
      title: '닫은 상태에서도 살피기 쉬운 전면 도어',
      cardTitle: '문을 닫아도\n서로 보이는 거리',
      body: '전면 철제 도어와 측면 환기 슬롯을 통해 이동 전후 반려동물 상태를 자연스럽게 확인할 수 있습니다.',
      image: `${SERVER_URL}/detail-page-assets/delto-kennel-door-vent-v1.png`,
    },
    {
      title: '한 손에 잡히는 상단 손잡이',
      cardTitle: '도착한 곳에서도\n곁에 두기',
      body: '상단 손잡이를 잡고 이동해 병원 대기, 외출, 짧은 드라이브처럼 반려동물과 함께 머무는 순간에 활용하기 좋습니다.',
      image: `${SERVER_URL}/detail-page-assets/delto-kennel-clinic-wait-v1.png`,
    },
  ],
  coverImage: `${SERVER_URL}/detail-page-assets/delto-kennel-outdoor-travel-v1.png`,
  structureTitle: '그레이블랙 단일 옵션',
  structureBody: '그레이 PP 바디, 블랙 철제 도어, 앞문 전용 식기까지 실제 판매 구성으로 확인된 요소만 담았습니다.',
  sizeParts: ['W 58 cm', 'D 37 cm', 'H 37 cm'],
  specificCautions: [
    '반려동물의 체형과 켄넬 내부 공간이 맞는지 확인한 뒤 사용해주세요.',
    '이동 전에는 앞문과 상단 문이 완전히 잠겼는지 확인해주세요.',
    '도어 식기 사용 시 반려동물의 발이나 털이 문틈에 끼지 않도록 주의해주세요.',
  ],
})

let activeSync = null
let automaticSyncStarted = false
let bridgeState = null
const imageHashCache = new Map()

figma.showUI(__html__, { width: 390, height: 520, themeColors: true })

function cleanText(value) {
  return String(value || '').trim()
}

function errorMessage(error) {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) return String(error.message)
  if (error && typeof error === 'object') {
    try {
      const details = {}
      for (const key of Object.getOwnPropertyNames(error)) details[key] = error[key]
      return JSON.stringify(details)
    } catch {
      return 'Unknown plugin error object.'
    }
  }
  return String(error || '알 수 없는 오류')
}

async function loadFonts() {
  await Promise.all([
    figma.loadFontAsync({ family: 'Inter', style: 'Regular' }),
    figma.loadFontAsync({ family: 'Inter', style: 'Semi Bold' }),
    figma.loadFontAsync({ family: 'Inter', style: 'Bold' }),
  ])
}

function makeText(value, size, style = 'Regular', color = COLORS.ink, width = 760) {
  const node = figma.createText()
  node.fontName = { family: 'Inter', style }
  node.fontSize = size
  node.characters = String(value)
  node.fills = [{ type: 'SOLID', color }]
  node.textAutoResize = 'HEIGHT'
  node.resize(width, node.height)
  return node
}

function makeSection(name, height, fill = COLORS.paper) {
  const section = figma.createFrame()
  section.name = name
  section.resize(860, height)
  section.fills = [{ type: 'SOLID', color: fill }]
  section.clipsContent = true
  section.layoutAlign = 'STRETCH'
  return section
}

function appendText(section, value, x, y, width, size, style = 'Regular', color = COLORS.ink) {
  const node = makeText(value, size, style, color, width)
  node.x = x
  node.y = y
  section.appendChild(node)
  return node
}

function makeLabel(section, value, x, y, width = 180, fill = COLORS.green) {
  const badge = figma.createFrame()
  badge.name = value
  badge.resize(width, 34)
  badge.x = x
  badge.y = y
  badge.cornerRadius = 17
  badge.fills = [{ type: 'SOLID', color: fill }]
  badge.appendChild(makeText(value, 12, 'Bold', COLORS.paper, width - 24))
  const label = badge.children[0]
  label.x = 12
  label.y = 9
  section.appendChild(badge)
}

function normalizeImageUrl(url) {
  return String(url).replace(/_\.webp(?=($|\?))/, '')
}

function withTimeout(promise, timeoutMs, errorText) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(errorText)), timeoutMs)
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

async function imagePaint(url) {
  const normalized = normalizeImageUrl(url)
  if (imageHashCache.has(normalized)) return imageHashCache.get(normalized)
  const response = await withTimeout(
    fetch(normalized),
    IMAGE_FETCH_TIMEOUT_MS,
    `자료 보완 필요: 이미지 응답 시간이 ${IMAGE_FETCH_TIMEOUT_MS / 1_000}초를 초과했습니다.`,
  )
  if (!response.ok) throw new Error(`자료 보완 필요: 이미지 응답 ${response.status} (${normalized})`)
  const contentType = String(response.headers?.get?.('content-type') || '')
  if (contentType && !contentType.includes('jpeg') && !contentType.includes('png')) {
    throw new Error(`자료 보완 필요: Figma에서 지원하지 않는 이미지 형식 (${contentType || 'unknown'})`)
  }
  const bytes = new Uint8Array(await withTimeout(
    response.arrayBuffer(),
    IMAGE_FETCH_TIMEOUT_MS,
    `자료 보완 필요: 이미지 데이터를 ${IMAGE_FETCH_TIMEOUT_MS / 1_000}초 안에 읽지 못했습니다.`,
  ))
  const hash = figma.createImage(bytes).hash
  imageHashCache.set(normalized, hash)
  return hash
}

async function makeImage(url, width, height, name) {
  const node = figma.createRectangle()
  node.name = name
  node.resize(width, height)
  node.fills = [{ type: 'IMAGE', imageHash: await imagePaint(url), scaleMode: 'FILL' }]
  node.setPluginData('source-image', normalizeImageUrl(url))
  return node
}

function pageTheme(brief) {
  return brief.theme || {
    dark: COLORS.green,
    soft: COLORS.mint,
    warm: COLORS.soft,
    accent: COLORS.amber,
    accentSoft: COLORS.paper,
  }
}

async function replaceSelectedImage(imageUrl) {
  const node = figma.currentPage.selection.find((candidate) => 'fills' in candidate)
  if (!node || !Array.isArray(node.fills)) {
    throw new Error('Select an image layer first.')
  }

  const imageIndex = node.fills.findIndex((paint) => paint.type === 'IMAGE')
  if (imageIndex < 0) {
    throw new Error('The selected layer has no image fill.')
  }

  const fills = [...node.fills]
  fills[imageIndex] = { ...fills[imageIndex], imageHash: await imagePaint(imageUrl) }
  node.fills = fills
  node.setPluginData('source-image', normalizeImageUrl(imageUrl))
  figma.viewport.scrollAndZoomIntoView([node])
  figma.ui.postMessage({ type: 'image-replaced', name: node.name })
}

async function replaceImageAtNode(command) {
  await figma.loadAllPagesAsync()
  let imageNode = null
  let matchedByName = false
  for (const page of figma.root.children) {
    const targetFrames = page.findAll((node) => (
      node.type === 'FRAME' && node.name.includes(command.targetFrameName)
    ))
    for (const targetFrame of targetFrames) {
      imageNode = targetFrame.findOne((node) => (
        node.name === command.targetNodeName
        && 'fills' in node
        && Array.isArray(node.fills)
        && node.fills.some((paint) => paint.type === 'IMAGE')
      ))
      if (imageNode) {
        matchedByName = true
        break
      }

      // Final composites preserve section names but not every inner layer name.
      // Prefer an image in the cover section, then fall back to the topmost image
      // in the target frame so a user-edited cover can still be replaced safely.
      const collectImageNodes = (scope) => {
        const nodes = [scope, ...scope.findAll((node) => (
          'fills' in node && Array.isArray(node.fills)
        ))]
        return nodes.filter((node) => (
          'fills' in node
          && Array.isArray(node.fills)
          && node.fills.some((paint) => paint.type === 'IMAGE')
        ))
      }
      const coverSections = targetFrame.children.filter((node) => (
        node.name.toLowerCase().includes('cover') || node.name.includes('커버')
      ))
      const coverImages = coverSections.flatMap((section) => collectImageNodes(section))
      const candidateImages = coverImages.length ? coverImages : collectImageNodes(targetFrame)
      candidateImages.sort((left, right) => {
        const leftY = left.absoluteTransform?.[1]?.[2] ?? 0
        const rightY = right.absoluteTransform?.[1]?.[2] ?? 0
        if (leftY !== rightY) return leftY - rightY
        return (right.width * right.height) - (left.width * left.height)
      })
      imageNode = candidateImages[0] ?? null
      if (imageNode) break
    }
    if (imageNode) break
  }

  if (!imageNode || !Array.isArray(imageNode.fills)) {
    throw new Error(`Image layer not found: ${command.targetNodeName}`)
  }

  const imageIndex = imageNode.fills.findIndex((paint) => paint.type === 'IMAGE')
  if (imageIndex < 0) throw new Error(`Image fill not found: ${command.targetNodeName}`)
  const fills = [...imageNode.fills]
  fills[imageIndex] = { ...fills[imageIndex], imageHash: await imagePaint(command.imageUrl) }
  imageNode.fills = fills
  imageNode.setPluginData('source-image', normalizeImageUrl(command.imageUrl))
  figma.ui.postMessage({ type: 'image-replaced', name: imageNode.name })
  return { imageNodeName: imageNode.name, matchedByName }
}

async function loadTextNodeFonts(node) {
  const fonts = new Map()
  for (let index = 0; index < node.characters.length; index += 1) {
    const font = node.getRangeFontName(index, index + 1)
    if (font === figma.mixed || !font?.family || !font?.style) continue
    fonts.set(`${font.family}:${font.style}`, font)
  }
  await Promise.all([...fonts.values()].map((font) => figma.loadFontAsync(font)))
}

async function replaceTextInFrame(command) {
  await figma.loadAllPagesAsync()
  await loadFonts()
  const frameId = cleanText(command.payload?.frameId)
  const replacements = Array.isArray(command.payload?.replacements) ? command.payload.replacements : []
  const frame = frameId ? await figma.getNodeByIdAsync(frameId) : null
  if (!frame || frame.type !== 'FRAME') throw new Error('The detail page frame for text replacement was not found.')
  if (!replacements.length) throw new Error('No text replacements were provided.')

  const textNodes = frame.findAll((node) => node.type === 'TEXT')
  const applied = []
  const missing = []
  for (const replacement of replacements) {
    const from = cleanText(replacement?.from)
    const to = cleanText(replacement?.to)
    if (!from || !to) continue
    const node = textNodes.find((candidate) => candidate.characters.trim() === from)
    if (!node) {
      missing.push(from)
      continue
    }
    await loadTextNodeFonts(node)
    node.characters = to
    applied.push(node.name || from)
  }
  if (!applied.length) throw new Error('The requested source copy was not found in the target frame.')
  return { frameId, appliedCount: applied.length, missingCount: missing.length }
}

async function captureFrameText(command) {
  await figma.loadAllPagesAsync()
  const frameId = cleanText(command.payload?.frameId)
  const frame = frameId ? await figma.getNodeByIdAsync(frameId) : null
  if (!frame || frame.type !== 'FRAME') throw new Error('The detail page frame for copy capture was not found.')

  const texts = frame.findAll((node) => node.type === 'TEXT')
    .map((node) => ({
      id: node.id,
      name: node.name,
      characters: node.characters,
      x: Math.round(node.x),
      y: Math.round(node.y),
      width: Math.round(node.width),
      height: Math.round(node.height),
    }))
    .filter((node) => node.characters.trim())
    .sort((left, right) => left.y - right.y || left.x - right.x)

  return { frameId, frameName: frame.name, texts }
}

async function makeCover(job, brief) {
  const theme = pageTheme(brief)
  const section = makeSection('00 COVER / CARD NEWS', 1320, theme.soft)
  const heroCard = figma.createFrame()
  heroCard.name = 'COVER IMAGE CARD'
  heroCard.resize(760, 820)
  heroCard.x = 50
  heroCard.y = 420
  heroCard.cornerRadius = 28
  heroCard.fills = [{ type: 'SOLID', color: theme.dark }]
  section.appendChild(heroCard)
  makeLabel(section, 'FUNTASTIC SELECT', 50, 48, 176, theme.accent)
  appendText(section, job.product.name, 50, 108, 760, 22, 'Semi Bold', COLORS.muted)
  appendText(section, brief.headline, 50, 170, 760, 52, 'Bold', theme.dark)
  appendText(section, brief.subhead, 50, 316, 760, 21, 'Regular', COLORS.muted)
  const image = await makeImage(brief.coverImage, 712, 728, '대표 이미지 · 이동 연출')
  image.cornerRadius = 20
  image.x = 24
  image.y = 24
  heroCard.appendChild(image)
  const caption = figma.createFrame()
  caption.name = 'COVER USP CARD'
  caption.resize(712, 44)
  caption.x = 24
  caption.y = 752
  caption.cornerRadius = 12
  caption.fills = [{ type: 'SOLID', color: theme.accent }]
  appendText(caption, 'DOUBLE DOOR · READY FOR THE NEXT TRIP', 22, 13, 668, 14, 'Bold', COLORS.paper)
  heroCard.appendChild(caption)
  return section
}

function optionEntries(brief) {
  if (Array.isArray(brief.options) && brief.options.length) return brief.options
  return [{
    name: brief.structureTitle.replace(/^선택 옵션\s*[·-]?\s*/, '') || '확인된 옵션',
    description: brief.structureBody,
    image: brief.coverImage,
  }]
}

async function makeOptionTable(brief) {
  const options = optionEntries(brief).slice(0, 2)
  const isSingle = options.length === 1
  const theme = pageTheme(brief)
  const section = makeSection('01 OPTION GUIDE / MARBIN STYLE', isSingle ? 940 : 860, theme.warm)
  makeLabel(section, 'OPTION GUIDE', 50, 54, 154, theme.dark)
  appendText(section, '내게 맞는 옵션을 골라보세요', 50, 120, 760, 42, 'Bold')
  appendText(section, '사용 환경에 자연스럽게 어울리는 그레이블랙 단일 옵션입니다.', 50, 186, 760, 19, 'Regular', COLORS.muted)

  const cardWidth = isSingle ? 760 : 370
  const cardHeight = isSingle ? 610 : 560
  const imageWidth = cardWidth - 48
  const imageHeight = isSingle ? 360 : 300
  for (const [index, option] of options.entries()) {
    const card = figma.createFrame()
    card.name = `OPTION ${String(index + 1).padStart(2, '0')} / ${option.name}`
    card.resize(cardWidth, cardHeight)
    card.x = 50 + (isSingle ? 0 : index * 390)
    card.y = 250
    card.cornerRadius = 22
    card.fills = [{ type: 'SOLID', color: COLORS.paper }]

    const image = await makeImage(option.image, imageWidth, imageHeight, `${card.name} · 실제 옵션 이미지`)
    image.x = 24
    image.y = 24
    card.appendChild(image)

    const badge = figma.createEllipse()
    badge.resize(48, 48)
    badge.x = 42
    badge.y = 42
    badge.fills = [{ type: 'SOLID', color: theme.accent }]
    card.appendChild(badge)
    const badgeText = appendText(card, String(index + 1).padStart(2, '0'), 42, 58, 48, 16, 'Bold', COLORS.paper)
    badgeText.textAlignHorizontal = 'CENTER'

    appendText(card, option.name, 24, imageHeight + 52, imageWidth, 28, 'Bold')
    appendText(card, option.description, 24, imageHeight + 104, imageWidth, 18, 'Regular', COLORS.muted)
    section.appendChild(card)
  }
  return section
}

function makeIntro(brief) {
  const theme = pageTheme(brief)
  const section = makeSection('02 PRODUCT STORY', 700, theme.dark)
  makeLabel(section, 'WHY THIS PRODUCT', 50, 54, 190, theme.accent)
  appendText(section, brief.introHeading || '꺼내는 동선을 바꾸면\n정리가 더 단순해집니다.', 50, 122, 760, 42, 'Bold', COLORS.paper)
  appendText(section, brief.intro, 50, 248, 760, 21, 'Regular', COLORS.paper)
  const line = figma.createRectangle()
  line.resize(760, 2)
  line.x = 50
  line.y = 420
  line.fills = [{ type: 'SOLID', color: theme.accentSoft }]
  section.appendChild(line)
  appendText(section, brief.eyebrow, 50, 472, 760, 16, 'Bold', theme.accentSoft)
  appendText(section, '반려동물과 함께하는 다음 이동을 더 편안하게 준비해보세요.', 50, 520, 760, 20, 'Semi Bold', COLORS.paper)
  return section
}

function makeFacts(brief) {
  const theme = pageTheme(brief)
  const cardFills = [theme.soft, theme.warm, theme.accentSoft, COLORS.paper]
  const section = makeSection('03 KEY POINTS', 760, COLORS.paper)
  makeLabel(section, 'KEY POINTS', 50, 54, 150, theme.dark)
  appendText(section, '이동 전에 확인하는\n델토 켄넬의 핵심 포인트', 50, 118, 760, 40, 'Bold', theme.dark)
  brief.facts.forEach(([label, value], index) => {
    const card = figma.createFrame()
    card.name = `${label} · ${value}`
    card.resize(370, 190)
    card.x = 50 + (index % 2) * 390
    card.y = 210 + Math.floor(index / 2) * 210
    card.cornerRadius = 18
    card.fills = [{ type: 'SOLID', color: cardFills[index % cardFills.length] }]
    appendText(card, label, 24, 28, 320, 13, 'Bold', theme.dark)
    appendText(card, value, 24, 76, 320, 23, 'Bold')
    section.appendChild(card)
  })
  return section
}

async function makeCheckpoint(index, checkpoint, brief) {
  const theme = pageTheme(brief)
  const fills = [COLORS.paper, theme.soft, theme.warm]
  const panelFills = [theme.dark, theme.accent, COLORS.green]
  const section = makeSection(`CHECK POINT ${String(index).padStart(2, '0')} / CARD NEWS`, 1040, fills[(index - 1) % fills.length])
  makeLabel(section, `CHECK POINT ${String(index).padStart(2, '0')}`, 50, 48, 168, panelFills[(index - 1) % panelFills.length])
  appendText(section, checkpoint.title, 50, 112, 760, 40, 'Bold', theme.dark)

  if (checkpoint.image) {
    const image = await makeImage(checkpoint.image, 470, 620, `${section.name} · ${checkpoint.title}`)
    image.x = 50
    image.y = 280
    image.cornerRadius = 22
    section.appendChild(image)
    const copyCard = figma.createFrame()
    copyCard.name = `CHECK POINT ${String(index).padStart(2, '0')} / USP CARD`
    copyCard.resize(266, 620)
    copyCard.x = 544
    copyCard.y = 280
    copyCard.cornerRadius = 22
    copyCard.fills = [{ type: 'SOLID', color: panelFills[(index - 1) % panelFills.length] }]
    appendText(copyCard, `MOMENT 0${index}`, 26, 44, 214, 14, 'Bold', COLORS.paper)
    appendText(copyCard, checkpoint.cardTitle || checkpoint.title, 26, 104, 214, 31, 'Bold', COLORS.paper)
    appendText(copyCard, checkpoint.body, 26, 252, 214, 18, 'Regular', COLORS.paper)
    const divider = figma.createRectangle()
    divider.resize(214, 2)
    divider.x = 26
    divider.y = 510
    divider.fills = [{ type: 'SOLID', color: COLORS.paper }]
    copyCard.appendChild(divider)
    appendText(copyCard, 'FUNTASTIC PET TRAVEL', 26, 548, 214, 12, 'Bold', COLORS.paper)
    section.appendChild(copyCard)
  } else {
    const diagram = figma.createFrame()
    diagram.name = '구조 설명 다이어그램'
    diagram.resize(760, 650)
    diagram.x = 50
    diagram.y = 340
    diagram.cornerRadius = 24
    diagram.fills = [{ type: 'SOLID', color: COLORS.mint }]
    checkpoint.diagram.forEach((label, itemIndex) => {
      const circle = figma.createEllipse()
      circle.resize(190, 190)
      circle.x = 45 + itemIndex * 240
      circle.y = 170
      circle.fills = [{ type: 'SOLID', color: COLORS.paper }]
      circle.strokes = [{ type: 'SOLID', color: COLORS.green }]
      circle.strokeWeight = 2
      diagram.appendChild(circle)
      appendText(diagram, `0${itemIndex + 1}`, 106 + itemIndex * 240, 225, 70, 16, 'Bold', COLORS.green)
      const title = appendText(diagram, label, 58 + itemIndex * 240, 290, 164, 17, 'Bold')
      title.textAlignHorizontal = 'CENTER'
    })
    appendText(diagram, '실제 제품에서 확인되는 형태만 단순화해 표시했습니다.', 90, 470, 580, 18, 'Regular', COLORS.muted)
    section.appendChild(diagram)
  }
  return section
}

function makeStructure(brief) {
  const theme = pageTheme(brief)
  const section = makeSection('07 OPTION & STRUCTURE', 740, theme.accentSoft)
  makeLabel(section, 'TRAVEL DETAIL', 50, 54, 156, theme.dark)
  appendText(section, brief.structureTitle, 50, 122, 760, 40, 'Bold', theme.dark)
  appendText(section, brief.structureBody, 50, 198, 760, 20, 'Regular', COLORS.muted)
  const panel = figma.createFrame()
  panel.name = '옵션 혼용 금지 안내'
  panel.resize(760, 260)
  panel.x = 50
  panel.y = 390
  panel.cornerRadius = 20
  panel.fills = [{ type: 'SOLID', color: COLORS.paper }]
  appendText(panel, 'TRAVEL ROUTINE', 32, 34, 300, 14, 'Bold', theme.accent)
  appendText(panel, '외출 준비부터 도착 후 휴식까지', 32, 86, 680, 27, 'Bold', theme.dark)
  appendText(panel, '집 안에서 익숙해진 켄넬을 그대로 들어 이동하면 낯선 장소에서도 반려동물이 쉴 자리를 준비하기 편합니다.', 32, 148, 680, 18, 'Regular', COLORS.muted)
  section.appendChild(panel)
  return section
}

function makeSizeGuide(product, brief) {
  const theme = pageTheme(brief)
  const section = makeSection('08 SIZE GUIDE', 900, COLORS.paper)
  makeLabel(section, 'SIZE GUIDE', 50, 54, 138, theme.accent)
  appendText(section, '구매 전 실제 설치·사용 공간을\n반드시 확인해주세요.', 50, 122, 760, 40, 'Bold')
  appendText(section, `제품 표기 규격 · ${product.size || '자료 보완 필요'}`, 50, 244, 760, 19, 'Semi Bold', theme.dark)
  const diagram = figma.createFrame()
  diagram.name = '제품 규격 다이어그램'
  diagram.resize(760, 470)
  diagram.x = 50
  diagram.y = 350
  diagram.cornerRadius = 20
  diagram.fills = [{ type: 'SOLID', color: theme.soft }]
  const box = figma.createRectangle()
  box.resize(390, 230)
  box.x = 185
  box.y = 80
  box.fills = []
  box.strokes = [{ type: 'SOLID', color: theme.dark }]
  box.strokeWeight = 3
  diagram.appendChild(box)
  brief.sizeParts.forEach((value, index) => {
    const pill = figma.createFrame()
    pill.resize(200, 54)
    pill.x = 40 + index * 240
    pill.y = 365
    pill.cornerRadius = 27
    pill.fills = [{ type: 'SOLID', color: COLORS.paper }]
    const sizeText = appendText(pill, value, 12, 16, 176, 17, 'Bold', theme.dark)
    sizeText.textAlignHorizontal = 'CENTER'
    diagram.appendChild(pill)
  })
  section.appendChild(diagram)
  return section
}

function makeProductInfo(product) {
  const section = makeSection('09 PRODUCT INFO', 920, COLORS.soft)
  makeLabel(section, 'PRODUCT INFO', 50, 54, 166)
  appendText(section, '제품 정보', 50, 120, 760, 40, 'Bold')
  const fields = [
    ['상품명', product.name],
    ['옵션', product.option],
    ['재질', product.material],
    ['제품크기', product.size],
    ['무게', product.weight],
    ['제조사', product.manufacturer],
    ['제조국', product.country || '자료 보완 필요'],
  ]
  fields.forEach(([label, value], index) => {
    const row = figma.createFrame()
    row.name = label
    row.resize(760, 78)
    row.x = 50
    row.y = 205 + index * 86
    row.fills = [{ type: 'SOLID', color: index % 2 ? COLORS.paper : COLORS.soft }]
    appendText(row, label, 22, 25, 160, 15, 'Semi Bold', COLORS.muted)
    appendText(row, value || '-', 190, 23, 540, 17, 'Semi Bold', value === '자료 보완 필요' ? COLORS.red : COLORS.ink)
    section.appendChild(row)
  })
  return section
}

function makeCautions(brief) {
  const section = makeSection('09 NOTICE · REQUIRED FIRST', 1320, COLORS.paper)
  appendText(section, '주의사항', 50, 58, 760, 42, 'Bold', COLORS.red)
  appendText(section, '공통 주의사항 7개는 항상 먼저 표시합니다.', 50, 122, 760, 17, 'Semi Bold', COLORS.muted)
  REQUIRED_CAUTIONS.forEach((item, index) => {
    appendText(section, item, 50, 190 + index * 92, 760, 18, 'Regular', COLORS.ink)
  })
  const divider = figma.createRectangle()
  divider.resize(760, 2)
  divider.x = 50
  divider.y = 860
  divider.fills = [{ type: 'SOLID', color: COLORS.line }]
  section.appendChild(divider)
  appendText(section, '제품별 추가 주의사항', 50, 910, 760, 24, 'Bold')
  brief.specificCautions.forEach((item, index) => {
    appendText(section, `- ${item}`, 50, 968 + index * 82, 760, 18, 'Regular', COLORS.ink)
  })
  return section
}

function makeStandardCautions(brief) {
  const section = makeSection('10 NOTICE / FIXED CAUTIONS', 1160, COLORS.paper)
  const panel = figma.createFrame()
  panel.name = '주의사항 / 고정 7문구 + 제품별 안내'
  panel.resize(760, 1040)
  panel.x = 50
  panel.y = 60
  panel.fills = [{ type: 'SOLID', color: COLORS.soft }]
  section.appendChild(panel)
  appendText(panel, '주의사항', 32, 42, 680, 42, 'Bold', COLORS.red)
  REQUIRED_CAUTIONS.forEach((item, index) => {
    appendText(panel, item, 32, 142 + index * 64, 690, 18, 'Regular', COLORS.ink)
  })
  const divider = figma.createRectangle()
  divider.resize(696, 2)
  divider.x = 32
  divider.y = 650
  divider.fills = [{ type: 'SOLID', color: COLORS.line }]
  panel.appendChild(divider)
  appendText(panel, '제품별 주의사항', 32, 700, 690, 24, 'Bold')
  brief.specificCautions.forEach((item, index) => {
    appendText(panel, `- ${item}`, 32, 756 + index * 70, 690, 18, 'Regular', COLORS.ink)
  })
  return section
}

async function cloneIpNotice() {
  const source = await figma.getNodeByIdAsync(IP_NOTICE_NODE_ID)
  if (!source || !('clone' in source)) {
    throw new Error('자료 보완 필요: 기존 상세페이지의 지정 IP 안내 이미지 노드를 찾지 못했습니다.')
  }
  const clone = source.clone()
  clone.name = '11 IP 안내 이미지 · 지정 원본'
  if (Math.abs(clone.width - 860) > 1) {
    const sourceWidth = clone.width
    clone.remove()
    throw new Error(`자료 보완 필요: IP 안내 이미지 너비가 기준과 다릅니다. (${sourceWidth}px)`)
  }
  clone.layoutAlign = 'STRETCH'
  return clone
}

async function resolveTargetFrame(job, brief) {
  const requestedId = cleanText(job.figmaNodeId) || brief.targetNodeId
  const byId = requestedId ? await figma.getNodeByIdAsync(requestedId) : null
  if (byId && byId.type === 'FRAME') return byId
  for (const page of figma.root.children) {
    const match = page.findOne((node) => (
      node.type === 'FRAME'
      && node.getPluginData('funtastic-sku') === job.product.sku
      && node.getPluginData('funtastic-job-id') === job.id
    ))
    if (match && match.type === 'FRAME') return match
  }
  throw new Error(`자료 보완 필요: 재제작 대상 프레임(${requestedId || job.product.sku})을 찾지 못했습니다.`)
}

async function placeOnSharedDetailCanvas(target) {
  const anchor = await figma.getNodeByIdAsync(CANONICAL_DETAIL_PAGE_ANCHOR_ID)
  if (!anchor || anchor.type !== 'FRAME' || !anchor.parent || anchor.parent.type !== 'PAGE') {
    if (!target.parent || target.parent.type !== 'PAGE') {
      throw new Error('자료 보완 필요: 상세페이지 공용 캔버스를 찾지 못했습니다.')
    }
    return target.parent
  }

  const sharedPage = anchor.parent
  if (target.parent !== sharedPage) sharedPage.appendChild(target)
  target.x = anchor.x + anchor.width + 160
  target.y = anchor.y
  return sharedPage
}

async function buildDraft(job) {
  await loadFonts()
  const brief = PRODUCT_BRIEFS[job.product.sku]
  if (!brief) throw new Error(`자료 보완 필요: ${job.product.sku}의 검증된 제작 브리프가 없습니다.`)
  const target = await resolveTargetFrame(job, brief)
  const sharedPage = await placeOnSharedDetailCanvas(target)
  await figma.setCurrentPageAsync(sharedPage)

  const scratch = figma.createFrame()
  scratch.name = `BUILDING · ${job.product.sku}`
  scratch.x = target.x + target.width + 80
  scratch.y = target.y
  scratch.resize(860, 100)
  scratch.layoutMode = 'VERTICAL'
  scratch.primaryAxisSizingMode = 'AUTO'
  scratch.counterAxisSizingMode = 'FIXED'
  scratch.itemSpacing = 0
  scratch.paddingTop = 0
  scratch.paddingRight = 0
  scratch.paddingBottom = 0
  scratch.paddingLeft = 0
  scratch.fills = [{ type: 'SOLID', color: COLORS.paper }]

  try {
    scratch.appendChild(await makeCover(job, brief))
    scratch.appendChild(await makeOptionTable(brief))
    scratch.appendChild(makeIntro(brief))
    scratch.appendChild(makeFacts(brief))
    for (const [index, checkpoint] of brief.checkpoints.entries()) {
      scratch.appendChild(await makeCheckpoint(index + 1, checkpoint, brief))
    }
    scratch.appendChild(makeStructure(brief))
    scratch.appendChild(makeSizeGuide(job.product, brief))
    scratch.appendChild(makeProductInfo(job.product))
    scratch.appendChild(makeStandardCautions(brief))
    scratch.appendChild(await cloneIpNotice())

    const x = target.x
    const y = target.y
    for (const child of [...target.children]) child.remove()
    target.layoutMode = 'NONE'
    target.resize(860, 100)
    target.layoutMode = 'VERTICAL'
    target.primaryAxisSizingMode = 'AUTO'
    target.counterAxisSizingMode = 'FIXED'
    target.itemSpacing = 0
    target.paddingTop = 0
    target.paddingRight = 0
    target.paddingBottom = 0
    target.paddingLeft = 0
    target.fills = [{ type: 'SOLID', color: COLORS.paper }]
    while (scratch.children.length) target.appendChild(scratch.children[0])
    target.x = x
    target.y = y
    // Rebuilds of an approved final frame must retain the visible final-frame title.
    target.name = target.name.includes('통합 최종본')
      ? target.name
      : `${job.product.name} ${job.product.sku} · 카드뉴스형 상세페이지 초안`
    target.setPluginData('funtastic-job-id', job.id)
    target.setPluginData('funtastic-sku', job.product.sku)
    target.setPluginData('production-brief-version', PLUGIN_VERSION)
    scratch.remove()
    figma.currentPage.selection = [target]
    figma.viewport.scrollAndZoomIntoView([target])
    return target
  } catch (error) {
    try {
      scratch.remove()
    } catch {
      // 이미 제거된 임시 프레임이면 추가 정리가 필요하지 않습니다.
    }
    throw error
  }
}

function bytesToDataUrl(bytes) {
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return `data:image/jpeg;base64,${btoa(binary)}`
}

async function exportPreview(node, width) {
  if (!node || typeof node.exportAsync !== 'function') return null
  const bytes = await node.exportAsync({
    format: 'JPG',
    constraint: { type: 'WIDTH', value: width },
  })
  return bytesToDataUrl(bytes)
}

function isProductComparisonFrame(node, filters) {
  if (node.type !== 'FRAME') return false
  if (node.getPluginData('funtastic-final-composite') === 'true') return false
  const name = node.name || ''
  return filters.some((filter) => name.includes(filter))
}

async function captureComparisonFrames(command) {
  await figma.loadAllPagesAsync()
  const payload = command.payload || {}
  const filters = Array.isArray(payload.nameFilters)
    ? payload.nameFilters.filter((value) => typeof value === 'string' && value.trim()).slice(0, 4)
    : ['델토', '헬리겔']
  const maxFrames = Math.max(1, Math.min(Number(payload.maxFrames) || 8, 8))
  const frameEntries = []
  for (const page of figma.root.children) {
    for (const node of page.children) {
      if (isProductComparisonFrame(node, filters)) frameEntries.push({ page, frame: node })
    }
  }
  frameEntries.sort((left, right) => left.frame.name.localeCompare(right.frame.name))
  const selected = frameEntries.slice(0, maxFrames)
  if (!selected.length) throw new Error('델토 또는 헬리겔 최상위 상세페이지 프레임을 찾지 못했습니다.')

  const result = { capturedAt: new Date().toISOString(), frames: [] }
  let storedCharacters = 0
  const savePreview = async (node, width) => {
    const preview = await exportPreview(node, width)
    if (!preview || storedCharacters + preview.length > 3_000_000) return null
    storedCharacters += preview.length
    return preview
  }

  const captures = selected.map(({ page, frame }) => {
    const sections = frame.children
      .filter((node) => node.type === 'FRAME' || node.type === 'GROUP' || node.type === 'SECTION')
      .slice(0, 16)
    return {
      frame,
      sections,
      entry: {
      id: frame.id,
      name: frame.name,
      pageName: page.name,
      width: Math.round(frame.width),
      height: Math.round(frame.height),
      preview: null,
      sections: sections.map((section) => ({
          id: section.id,
          name: section.name,
          type: section.type,
          width: Math.round(section.width),
          height: Math.round(section.height),
          preview: null,
      })),
    },
  }
  })

  // A complete page thumbnail is mandatory for every source draft. Section
  // thumbnails use only the remaining payload budget after that comparison set.
  for (const capture of captures) {
    capture.entry.preview = await savePreview(capture.frame, 150)
    result.frames.push(capture.entry)
  }
  for (const capture of captures) {
    for (let index = 0; index < capture.entry.sections.length; index += 1) {
      capture.entry.sections[index].preview = await savePreview(capture.sections[index], 128)
    }
  }
  figma.ui.postMessage({ type: 'comparison-captured', frameCount: result.frames.length })
  return result
}

async function composeFinalDetailPage(command) {
  await figma.loadAllPagesAsync()
  const productName = cleanText(command.targetFrameName) || '상세페이지'
  const selections = Array.isArray(command.payload?.selections) ? command.payload.selections.slice(0, 24) : []
  if (selections.length < 3) throw new Error('통합 최종본에 넣을 섹션이 부족합니다.')

  const sourceFrames = []
  const sourceSections = []
  for (const selection of selections) {
    const sourceFrame = await figma.getNodeByIdAsync(selection.sourceFrameId)
    const sourceSection = await figma.getNodeByIdAsync(selection.sectionId)
    if (!sourceFrame || sourceFrame.type !== 'FRAME' || !sourceSection || typeof sourceSection.clone !== 'function') {
      throw new Error(`통합할 원본 섹션을 찾지 못했습니다: ${selection.sectionName || 'unnamed section'}`)
    }
    sourceFrames.push(sourceFrame)
    sourceSections.push(sourceSection)
  }
  const sourcePage = sourceFrames[0].parent
  if (!sourcePage || sourcePage.type !== 'PAGE') throw new Error('원본 상세페이지가 Figma 페이지 최상위에 있어야 합니다.')
  if (sourceFrames.some((frame) => frame.parent !== sourcePage)) {
    throw new Error('한 번의 통합은 같은 Figma 페이지 안의 초안만 사용할 수 있습니다.')
  }

  await figma.setCurrentPageAsync(sourcePage)
  const finalFrame = figma.createFrame()
  finalFrame.name = `${productName} · 통합 최종본 · 2026-07-31`
  finalFrame.resize(860, 100)
  finalFrame.layoutMode = 'VERTICAL'
  finalFrame.primaryAxisSizingMode = 'AUTO'
  finalFrame.counterAxisSizingMode = 'FIXED'
  finalFrame.itemSpacing = 0
  finalFrame.paddingTop = 0
  finalFrame.paddingRight = 0
  finalFrame.paddingBottom = 0
  finalFrame.paddingLeft = 0
  finalFrame.fills = [{ type: 'SOLID', color: COLORS.paper }]

  for (const section of sourceSections) {
    const copy = section.clone()
    if ('layoutAlign' in copy) copy.layoutAlign = 'STRETCH'
    finalFrame.appendChild(copy)
  }

  const maxX = Math.max(...sourceFrames.map((frame) => frame.x + frame.width))
  const minY = Math.min(...sourceFrames.map((frame) => frame.y))
  finalFrame.x = maxX + 160
  finalFrame.y = minY
  finalFrame.setPluginData('funtastic-final-composite', 'true')
  finalFrame.setPluginData('funtastic-composition', JSON.stringify(selections.map((selection) => ({
    sourceFrameId: selection.sourceFrameId,
    sectionId: selection.sectionId,
    sectionName: selection.sectionName,
  }))))
  figma.currentPage.selection = [finalFrame]
  figma.viewport.scrollAndZoomIntoView([finalFrame])
  const figmaUrl = `https://www.figma.com/design/${DEFAULT_FILE_KEY}/ai-%EC%83%9D%EC%84%B1-%EC%83%81%EC%84%B8%ED%8E%98%EC%9D%B4%EC%A7%80?node-id=${encodeURIComponent(finalFrame.id.replace(':', '-'))}`
  figma.ui.postMessage({ type: 'final-composed', name: finalFrame.name })
  return { finalFrameId: finalFrame.id, finalFrameName: finalFrame.name, figmaUrl }
}

async function renameFigmaFrame(command) {
  await figma.loadAllPagesAsync()
  const frameId = cleanText(command.payload?.frameId)
  const name = cleanText(command.payload?.name)
  if (!frameId || !name) throw new Error('The Figma frame rename data is incomplete.')

  const node = await figma.getNodeByIdAsync(frameId)
  if (!node || node.type !== 'FRAME') throw new Error('The Figma frame to rename was not found.')

  node.name = name
  const figmaUrl = `https://www.figma.com/design/${DEFAULT_FILE_KEY}/ai-%EC%83%9D%EC%84%B1-%EC%83%81%EC%84%B8%ED%8E%98%EC%9D%B4%EC%A7%80?node-id=${encodeURIComponent(node.id.replace(':', '-'))}`
  return { frameId: node.id, frameName: node.name, figmaUrl }
}

async function replaceWithSingleTransparentOption(command) {
  await figma.loadAllPagesAsync()
  await loadFonts()
  const frameId = cleanText(command.payload?.frameId)
  if (!frameId) throw new Error('The detail page frame is missing.')

  const detailPage = await figma.getNodeByIdAsync(frameId)
  if (!detailPage || detailPage.type !== 'FRAME') throw new Error('The detail page frame was not found.')
  const optionSection = detailPage.children.find((child) => child.type === 'FRAME' && child.name.includes('옵션'))
  if (!optionSection || optionSection.type !== 'FRAME') throw new Error('The existing option section was not found.')

  const imageCandidates = optionSection.findAll((node) => (
    'fills' in node
    && Array.isArray(node.fills)
    && node.fills.some((paint) => paint.type === 'IMAGE')
  ))
  const sourceImage = imageCandidates
    .sort((left, right) => (right.width * right.height) - (left.width * left.height))[0]
  if (!sourceImage || typeof sourceImage.clone !== 'function') {
    throw new Error('A transparent product image could not be found in the option section.')
  }

  const replacement = makeSection('02 옵션 안내 / 투명 단일 옵션', 800, COLORS.soft)
  makeLabel(replacement, 'OPTION', 50, 52, 124)
  appendText(replacement, '완전 투명, 단일 옵션', 50, 118, 760, 44, 'Bold')
  appendText(replacement, '색상 선택 없이 투명 단일 구성으로 판매합니다.', 50, 186, 760, 21, 'Regular', COLORS.muted)

  const image = sourceImage.clone()
  if ('resize' in image) image.resize(470, 470)
  image.x = 50
  image.y = 274
  replacement.appendChild(image)

  const card = figma.createFrame()
  card.name = '투명 단일 옵션 안내'
  card.resize(240, 470)
  card.x = 570
  card.y = 274
  card.cornerRadius = 16
  card.fills = [{ type: 'SOLID', color: COLORS.paper }]
  appendText(card, '01', 28, 34, 184, 16, 'Bold', COLORS.green)
  appendText(card, '투명', 28, 86, 184, 34, 'Bold')
  appendText(card, '주방과 냉장고 안에서 내용물이 자연스럽게 보이는 투명 단일 옵션입니다.', 28, 154, 184, 18, 'Regular', COLORS.muted)
  replacement.appendChild(card)

  const index = detailPage.children.indexOf(optionSection)
  detailPage.insertChild(index, replacement)
  optionSection.remove()
  const figmaUrl = `https://www.figma.com/design/${DEFAULT_FILE_KEY}/ai-%EC%83%9D%EC%84%B1-%EC%83%81%EC%84%B8%ED%8E%98%EC%9D%B4%EC%A7%80?node-id=${encodeURIComponent(detailPage.id.replace(':', '-'))}`
  return { frameId: detailPage.id, sectionName: replacement.name, figmaUrl }
}

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Funtastic-Plugin-Version': PLUGIN_VERSION,
  }
}

async function request(path, options = {}) {
  const response = await fetch(`${SERVER_URL}${path}`, options)
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || `서버 응답 ${response.status}`)
  return body
}

async function readBridgeState() {
  if (bridgeState?.bridgeToken) return bridgeState
  try {
    const stored = await figma.clientStorage.getAsync(BRIDGE_STATE_KEY)
    if (stored?.bridgeToken) bridgeState = stored
  } catch {
    // Development plugins can lack client-storage access in some Figma sessions.
  }
  if (!bridgeState?.bridgeToken) {
    try {
      const stored = figma.root.getPluginData(BRIDGE_STATE_KEY)
      const parsed = stored ? JSON.parse(stored) : null
      if (parsed?.bridgeToken) bridgeState = parsed
    } catch {
      // A corrupt or unavailable document fallback must not block the plugin.
    }
  }
  return bridgeState
}

async function rememberBridgeState(nextState) {
  bridgeState = nextState
  try {
    await figma.clientStorage.setAsync(BRIDGE_STATE_KEY, nextState)
  } catch {
    // The document fallback below keeps development-plugin pairing durable.
  }
  try {
    figma.root.setPluginData(BRIDGE_STATE_KEY, JSON.stringify(nextState))
  } catch {
    // Memory storage still lets the current session complete its active work.
  }
}

async function initialize() {
  const state = await readBridgeState()
  figma.ui.postMessage({
    type: 'state',
    paired: Boolean(state?.bridgeToken),
    deviceName: state?.deviceName || 'AI 상세페이지 파일',
    figmaFileKey: state?.figmaFileKey || DEFAULT_FILE_KEY,
    pluginVersion: PLUGIN_VERSION,
  })
  if (state?.bridgeToken) startAutomaticSync()
}

async function pair(message) {
  const data = await request('/api/operations/detail-pages/bridge/pair', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pairingToken: message.pairingToken,
      deviceName: message.deviceName || 'AI 상세페이지 파일',
      figmaFileKey: message.figmaFileKey || DEFAULT_FILE_KEY,
      pluginVersion: PLUGIN_VERSION,
    }),
  })
  await rememberBridgeState({
    bridgeToken: data.bridgeToken,
    deviceName: message.deviceName || 'AI 상세페이지 파일',
    figmaFileKey: message.figmaFileKey || DEFAULT_FILE_KEY,
  })
  figma.ui.postMessage({ type: 'paired' })
  startAutomaticSync()
  await sync()
}

async function requestComparisonCapture() {
  const state = await readBridgeState()
  if (!state?.bridgeToken) throw new Error('먼저 SaaS에서 만든 연결 코드를 입력해주세요.')
  await request('/api/operations/detail-pages/bridge/compare', {
    method: 'POST',
    headers: authHeaders(state.bridgeToken),
  })
  figma.ui.postMessage({ type: 'comparison-requested' })
  await sync()
}

function startAutomaticSync() {
  if (automaticSyncStarted) return
  automaticSyncStarted = true
  figma.ui.postMessage({ type: 'automatic-sync' })
  void sync(true).catch((error) => {
    figma.ui.postMessage({ type: 'error', message: `자동 동기화 오류입니다: ${errorMessage(error)}` })
  })
}

async function heartbeat() {
  const state = await readBridgeState()
  if (!state?.bridgeToken) {
    await initialize()
    return
  }
  await sync(true)
}

async function sync(silent = false) {
  if (activeSync) return activeSync
  activeSync = runSync(silent)
  try {
    return await activeSync
  } finally {
    activeSync = null
  }
}

async function runSync(silent) {
  const state = await readBridgeState()
  if (!state?.bridgeToken) throw new Error('먼저 SaaS에서 만든 연결 코드를 입력해주세요.')
  let completed = 0
  let empty = false
  for (let index = 0; index < 10; index += 1) {
    const { command } = await request('/api/operations/detail-pages/bridge/commands', {
      method: 'POST',
      headers: authHeaders(state.bridgeToken),
    })
    if (command) {
      try {
        let result
        const label = command.commandType === 'replace-image'
          ? 'Image replacement'
          : command.commandType === 'replace-text'
            ? 'USP copy replacement'
          : command.commandType === 'capture-frames'
            ? 'Draft comparison'
            : command.commandType === 'compose-final'
              ? 'Final detail page'
              : command.commandType === 'rename-frame'
                ? 'Frame rename'
                : command.commandType === 'replace-option-section'
                  ? 'Single transparent option'
                  : command.commandType === 'capture-text'
                    ? 'Detail page copy capture'
                    : command.commandType
        figma.ui.postMessage({ type: 'progress', name: label, index: completed + 1 })
        if (command.commandType === 'replace-image') {
          result = await replaceImageAtNode(command)
        } else if (command.commandType === 'replace-text') {
          result = await replaceTextInFrame(command)
        } else if (command.commandType === 'capture-text') {
          result = await captureFrameText(command)
        } else if (command.commandType === 'capture-frames') {
          result = await captureComparisonFrames(command)
        } else if (command.commandType === 'compose-final') {
          result = await composeFinalDetailPage(command)
        } else if (command.commandType === 'rename-frame') {
          result = await renameFigmaFrame(command)
        } else if (command.commandType === 'replace-option-section') {
          result = await replaceWithSingleTransparentOption(command)
        } else {
          throw new Error(`지원하지 않는 Figma 작업입니다: ${command.commandType}`)
        }
        await request(`/api/operations/detail-pages/bridge/commands/${command.id}`, {
          method: 'POST',
          headers: authHeaders(state.bridgeToken),
          body: JSON.stringify({ status: 'completed', ...(result ? { result } : {}) }),
        })
        completed += 1
      } catch (error) {
        await request(`/api/operations/detail-pages/bridge/commands/${command.id}`, {
          method: 'POST',
          headers: authHeaders(state.bridgeToken),
          body: JSON.stringify({ status: 'failed', errorMessage: errorMessage(error) }),
        }).catch(() => {})
        figma.ui.postMessage({ type: 'error', message: errorMessage(error) })
      }
      continue
    }
    const { job } = await request('/api/operations/detail-pages/bridge/jobs', {
      method: 'POST',
      headers: authHeaders(state.bridgeToken),
    })
    if (!job) {
      empty = true
      break
    }
    try {
      figma.ui.postMessage({ type: 'progress', name: job.product.name, index: completed + 1 })
      const frame = await buildDraft(job)
      const nodeId = frame.id
      const figmaUrl = `https://www.figma.com/design/${job.figmaFileKey}/ai-%EC%83%9D%EC%84%B1-%EC%83%81%EC%84%B8%ED%8E%98%EC%9D%B4%EC%A7%80?node-id=${encodeURIComponent(nodeId.replace(':', '-'))}`
      await request(`/api/operations/detail-pages/bridge/jobs/${job.id}`, {
        method: 'POST',
        headers: authHeaders(state.bridgeToken),
        body: JSON.stringify({ status: 'review', figmaNodeId: nodeId, figmaUrl }),
      })
      completed += 1
    } catch (error) {
      await request(`/api/operations/detail-pages/bridge/jobs/${job.id}`, {
        method: 'POST',
        headers: authHeaders(state.bridgeToken),
        body: JSON.stringify({ status: 'failed', errorMessage: errorMessage(error) }),
      }).catch(() => {})
      figma.ui.postMessage({ type: 'error', message: errorMessage(error) })
    }
  }
  if (!silent || completed > 0) figma.ui.postMessage({ type: 'synced', completed, empty })
}

figma.ui.onmessage = async (message) => {
  try {
    if (message.type === 'ui-ready') await initialize()
    if (message.type === 'heartbeat') await heartbeat()
    if (message.type === 'pair') await pair(message)
    if (message.type === 'sync') await sync()
    if (message.type === 'capture-comparison') await requestComparisonCapture()
  } catch (error) {
    figma.ui.postMessage({ type: 'error', message: errorMessage(error) })
  }
}

void initialize()
