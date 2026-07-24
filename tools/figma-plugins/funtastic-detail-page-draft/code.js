const SERVER_URL = 'https://funtastic-saas-vercel.vercel.app'
const PLUGIN_VERSION = '1.0.0'
const DEFAULT_FILE_KEY = 'X8yYgVtrAFKycEA0yy0kWI'

figma.showUI(__html__, { width: 390, height: 500, themeColors: true })

function text(value) {
  return String(value || '').trim()
}

async function loadFonts() {
  await Promise.all([
    figma.loadFontAsync({ family: 'Inter', style: 'Regular' }),
    figma.loadFontAsync({ family: 'Inter', style: 'Semi Bold' }),
    figma.loadFontAsync({ family: 'Inter', style: 'Bold' }),
  ])
}

function makeText(characters, size, style = 'Regular', color = { r: 0.08, g: 0.1, b: 0.15 }) {
  const node = figma.createText()
  node.fontName = { family: 'Inter', style }
  node.fontSize = size
  node.characters = characters
  node.fills = [{ type: 'SOLID', color }]
  node.textAutoResize = 'HEIGHT'
  node.layoutAlign = 'STRETCH'
  return node
}

function makeSectionTitle(value) {
  const title = makeText(value, 20, 'Bold')
  title.name = value
  return title
}

function makeInfoRow(label, value) {
  const row = figma.createFrame()
  row.name = label
  row.layoutMode = 'HORIZONTAL'
  row.primaryAxisSizingMode = 'AUTO'
  row.counterAxisSizingMode = 'AUTO'
  row.layoutAlign = 'STRETCH'
  row.itemSpacing = 20
  row.paddingTop = 12
  row.paddingBottom = 12
  row.paddingLeft = 14
  row.paddingRight = 14
  row.fills = [{ type: 'SOLID', color: { r: 0.97, g: 0.97, b: 0.98 } }]
  row.cornerRadius = 8
  const labelNode = makeText(label, 13, 'Semi Bold', { r: 0.35, g: 0.38, b: 0.43 })
  labelNode.resize(130, labelNode.height)
  labelNode.layoutSizingHorizontal = 'FIXED'
  const valueNode = makeText(value || '-', 14, 'Regular')
  valueNode.layoutSizingHorizontal = 'FILL'
  row.appendChild(labelNode)
  row.appendChild(valueNode)
  return row
}

async function imagePaint(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`이미지 응답 ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  return figma.createImage(bytes).hash
}

async function makeImage(url, width, height, name) {
  const node = figma.createRectangle()
  node.name = name
  node.resize(width, height)
  node.cornerRadius = 10
  node.layoutAlign = 'STRETCH'
  try {
    const imageHash = await imagePaint(url)
    node.fills = [{ type: 'IMAGE', imageHash, scaleMode: 'FILL' }]
  } catch {
    node.fills = [{ type: 'SOLID', color: { r: 0.92, g: 0.93, b: 0.95 } }]
    node.setPluginData('source-image', url)
    node.setPluginData('image-state', 'failed')
  }
  return node
}

async function targetPage() {
  const existing = figma.root.children.find((page) => page.name === 'AI 상세페이지')
  const page = existing || figma.createPage()
  if (!existing) page.name = 'AI 상세페이지'
  await figma.setCurrentPageAsync(page)
  return page
}

function nextCanvasPosition(page) {
  const right = page.children.reduce((max, node) => Math.max(max, node.x + node.width), 0)
  return right > 0 ? right + 180 : 0
}

async function buildDraft(job) {
  await loadFonts()
  const page = await targetPage()
  const product = job.product
  const frame = figma.createFrame()
  frame.name = `${product.name} ${product.sku} 상세페이지 초안`
  frame.x = nextCanvasPosition(page)
  frame.y = 0
  frame.resize(860, 100)
  frame.layoutMode = 'VERTICAL'
  frame.primaryAxisSizingMode = 'AUTO'
  frame.counterAxisSizingMode = 'FIXED'
  frame.paddingTop = 40
  frame.paddingRight = 40
  frame.paddingBottom = 48
  frame.paddingLeft = 40
  frame.itemSpacing = 22
  frame.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }]
  frame.setPluginData('funtastic-job-id', job.id)
  frame.setPluginData('funtastic-sku', product.sku)

  const eyebrow = makeText(`AI GENERATED DETAIL PAGE · ${product.sku}`, 12, 'Semi Bold', { r: 0.3, g: 0.36, b: 0.45 })
  eyebrow.letterSpacing = { value: 4, unit: 'PERCENT' }
  frame.appendChild(eyebrow)
  frame.appendChild(makeText(product.name, 34, 'Bold'))
  if (text(product.option)) frame.appendChild(makeText(product.option, 17, 'Regular', { r: 0.35, g: 0.38, b: 0.43 }))

  const images = Array.isArray(job.imageUrls) ? job.imageUrls.slice(0, 6) : []
  if (images.length > 0) {
    frame.appendChild(await makeImage(images[0], 780, 720, '대표 이미지'))
    if (images.length > 1) {
      const gallery = figma.createFrame()
      gallery.name = '상세 이미지'
      gallery.layoutMode = 'HORIZONTAL'
      gallery.primaryAxisSizingMode = 'AUTO'
      gallery.counterAxisSizingMode = 'AUTO'
      gallery.layoutAlign = 'STRETCH'
      gallery.itemSpacing = 12
      for (const [index, imageUrl] of images.slice(1, 4).entries()) {
        const image = await makeImage(imageUrl, 246, 246, `상세 이미지 ${index + 2}`)
        image.layoutSizingHorizontal = 'FILL'
        gallery.appendChild(image)
      }
      frame.appendChild(gallery)
    }
  } else {
    frame.appendChild(await makeImage('', 780, 440, '대표 이미지 없음'))
  }

  const summary = figma.createFrame()
  summary.name = '상품 핵심 메시지'
  summary.layoutMode = 'VERTICAL'
  summary.primaryAxisSizingMode = 'AUTO'
  summary.counterAxisSizingMode = 'AUTO'
  summary.layoutAlign = 'STRETCH'
  summary.paddingTop = 28
  summary.paddingRight = 28
  summary.paddingBottom = 28
  summary.paddingLeft = 28
  summary.itemSpacing = 10
  summary.cornerRadius = 12
  summary.fills = [{ type: 'SOLID', color: { r: 0.94, g: 0.96, b: 0.99 } }]
  summary.appendChild(makeText('상품 핵심 포인트', 16, 'Bold'))
  const keyPoint = [text(product.material), text(product.size), text(product.capacity)].filter(Boolean).join(' · ')
  summary.appendChild(makeText(keyPoint || '상품의 핵심 장점과 사용 장면을 검수 후 보완해주세요.', 18, 'Semi Bold'))
  if (text(job.note)) summary.appendChild(makeText(`제작 메모: ${job.note}`, 13, 'Regular', { r: 0.35, g: 0.38, b: 0.43 }))
  frame.appendChild(summary)

  frame.appendChild(makeSectionTitle('상품 정보'))
  const fields = [
    ['재질', product.material],
    ['제품크기', product.size],
    ['제조사', product.manufacturer],
    ['무게', product.weight],
    ['제조국', product.country],
    ['용량', product.capacity],
  ]
  for (const [label, value] of fields) frame.appendChild(makeInfoRow(label, text(value)))

  const footer = makeText('초안 자동 생성본입니다. 이미지·카피·상품 고지 정보를 검수한 뒤 최종 상세페이지로 다듬어주세요.', 12, 'Regular', { r: 0.42, g: 0.45, b: 0.5 })
  footer.textAlignHorizontal = 'CENTER'
  frame.appendChild(footer)

  figma.currentPage.selection = [frame]
  figma.viewport.scrollAndZoomIntoView([frame])
  return frame
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

async function initialize() {
  const state = await figma.clientStorage.getAsync('funtastic-detail-page-bridge')
  figma.ui.postMessage({
    type: 'state',
    paired: Boolean(state?.bridgeToken),
    deviceName: state?.deviceName || 'AI 상세페이지 파일',
    figmaFileKey: state?.figmaFileKey || DEFAULT_FILE_KEY,
  })
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
  await figma.clientStorage.setAsync('funtastic-detail-page-bridge', {
    bridgeToken: data.bridgeToken,
    deviceName: message.deviceName || 'AI 상세페이지 파일',
    figmaFileKey: message.figmaFileKey || DEFAULT_FILE_KEY,
  })
  figma.ui.postMessage({ type: 'paired' })
  // A successful one-time pairing should immediately process the item the
  // operator just queued in SaaS, without requiring a second plugin click.
  await sync()
}

async function sync() {
  const state = await figma.clientStorage.getAsync('funtastic-detail-page-bridge')
  if (!state?.bridgeToken) throw new Error('먼저 SaaS에서 만든 연결 코드를 입력해주세요.')
  let completed = 0
  let empty = false
  for (let index = 0; index < 10; index += 1) {
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
        body: JSON.stringify({ status: 'failed', errorMessage: error instanceof Error ? error.message : String(error) }),
      }).catch(() => {})
    }
  }
  figma.ui.postMessage({ type: 'synced', completed, empty })
}

figma.ui.onmessage = async (message) => {
  try {
    if (message.type === 'pair') await pair(message)
    if (message.type === 'sync') await sync()
  } catch (error) {
    figma.ui.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}

void initialize()
