import type { Page } from 'playwright'

type ProgressCallback = (message: string) => Promise<void>

export async function dismissRpaPopups(
  page: Page,
  options?: {
    marketplaceName?: string
    setProgress?: ProgressCallback
    maxPasses?: number
  },
): Promise<boolean> {
  const label = options?.marketplaceName ?? 'RPA'
  const maxPasses = options?.maxPasses ?? 5
  let dismissed = false

  for (const popupPage of page.context().pages()) {
    if (popupPage === page || popupPage.isClosed()) continue
    dismissed = true
    await options?.setProgress?.(`${label} 팝업 창 닫는 중...`)
    await popupPage.close().catch(() => undefined)
  }

  for (let pass = 0; pass < maxPasses; pass += 1) {
    let clickedThisPass = false

    for (const frame of page.frames()) {
      const clicked = await frame.evaluate(() => {
        const normalizeText = (value: string) => value.replace(/\s+/g, ' ').trim()
        const visible = (element: HTMLElement) => {
          const rect = element.getBoundingClientRect()
          const style = window.getComputedStyle(element)
          return rect.width > 0
            && rect.height > 0
            && style.visibility !== 'hidden'
            && style.display !== 'none'
            && style.opacity !== '0'
        }
        const textOf = (element: HTMLElement) => {
          if (element instanceof HTMLInputElement) {
            const labels = element.labels ? Array.from(element.labels).map((label) => label.textContent || '').join(' ') : ''
            return normalizeText(`${element.value || ''} ${element.getAttribute('aria-label') || ''} ${element.title || ''} ${labels}`)
          }
          return normalizeText(`${element.innerText || element.textContent || ''} ${element.getAttribute('title') || ''} ${element.getAttribute('aria-label') || ''}`)
        }
        const popupContainerOf = (element: HTMLElement) => {
          let current: HTMLElement | null = element
          while (current && current !== document.body) {
            const attrs = `${current.id} ${current.className} ${current.getAttribute('role') || ''} ${current.getAttribute('aria-modal') || ''}`.toLowerCase()
            const style = window.getComputedStyle(current)
            const zIndex = Number.parseInt(style.zIndex || '0', 10)
            if (
              /dialog|modal|popup|pop|layer|notice|toast|alert|banner|공지|알림|안내/.test(attrs)
              || current.getAttribute('aria-modal') === 'true'
              || current.getAttribute('role') === 'dialog'
              || (Number.isFinite(zIndex) && zIndex >= 100)
            ) {
              return current
            }
            current = current.parentElement
          }
          return null
        }

        const controls = Array.from(document.querySelectorAll<HTMLElement>(
          'button, input[type="button"], input[type="submit"], input[type="checkbox"], a, [role="button"], [onclick], img[title], span, label',
        ))
          .filter((element) => visible(element))
          .map((element) => {
            const text = textOf(element)
            const rect = element.getBoundingClientRect()
            const container = popupContainerOf(element)
            const containerText = normalizeText(container?.textContent || '')
            let score = 100

            if (/오늘\s*(하루)?\s*(그만|보지\s*않기|닫기)|하루\s*동안\s*보지\s*않기|다시\s*보지\s*않기|일주일\s*보지\s*않기|더\s*이상\s*보지/i.test(text)) score = 0
            if (/^(닫기|창닫기|확인|취소|close|ok|x|×)$/i.test(text)) score = Math.min(score, 10)
            if (/닫기|close|창닫기|×|x/i.test(text)) score = Math.min(score, 20)
            if (element instanceof HTMLInputElement && element.type === 'checkbox' && /오늘|하루|다시|보지|더\s*이상/i.test(text || containerText)) score = 0

            if (!container && !/^(x|×)$/i.test(text)) score += 80
            if (/조회|검색|다운로드|엑셀|주문확인|저장|로그인|메뉴|관리|등록|수정|삭제|확인정보/i.test(text)) score += 100
            if (containerText && !/공지|알림|안내|notice|popup|확인|닫기|오늘|하루|다시|보지|이벤트|팝업/i.test(containerText)) score += 30

            return { element, score, x: rect.left, y: rect.top }
          })
          .filter((candidate) => candidate.score < 100)
          .sort((a, b) => a.score - b.score || (b.y + b.x) - (a.y + a.x))

        const target = controls[0]?.element
        if (!(target instanceof HTMLElement)) return false

        if (target instanceof HTMLInputElement && target.type === 'checkbox') {
          if (!target.checked) target.click()
          return true
        }

        target.click()
        return true
      }).catch(() => false)

      if (clicked) {
        dismissed = true
        clickedThisPass = true
        await options?.setProgress?.(`${label} 공지/팝업 닫는 중...`)
        await page.waitForTimeout(300)
      }
    }

    if (!clickedThisPass) break
  }

  if (!dismissed) {
    await page.keyboard.press('Escape').catch(() => undefined)
  }

  return dismissed
}
