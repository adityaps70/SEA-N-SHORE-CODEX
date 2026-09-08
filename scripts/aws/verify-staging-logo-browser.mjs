import { chromium } from '@playwright/test'

const url = process.env.STAGING_URL || 'https://d3prih0q6jofyr.cloudfront.net'
const assetPath = '/brand/sea-and-shore-header-logo.svg'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1536, height: 1024 } })

const consoleErrors = []
const failedRequests = []
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text())
})
page.on('requestfailed', (request) => {
  failedRequests.push({ url: request.url(), failure: request.failure()?.errorText ?? 'unknown' })
})

try {
  const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 })
  console.log(`PAGE_STATUS=${response?.status() ?? 'none'}`)
  console.log(`PAGE_URL=${page.url()}`)

  const logo = page.locator(`img[src="${assetPath}"]`).first()
  const count = await logo.count()
  console.log(`LOGO_COUNT=${count}`)

  if (count !== 1) {
    await page.screenshot({ path: '/tmp/sea-n-shore-logo-browser.png', fullPage: true })
    throw new Error(`Expected one compact logo image, found ${count}`)
  }

  await logo.waitFor({ state: 'attached', timeout: 10_000 })

  const state = await logo.evaluate((element) => {
    const img = element
    const rect = img.getBoundingClientRect()
    const style = getComputedStyle(img)
    const parent = img.parentElement
    const parentRect = parent?.getBoundingClientRect()
    const parentStyle = parent ? getComputedStyle(parent) : null
    return {
      src: img.getAttribute('src'),
      currentSrc: img.currentSrc,
      complete: img.complete,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      rect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
      style: {
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        position: style.position,
        overflow: style.overflow,
      },
      parent: parentRect
        ? {
            rect: {
              x: parentRect.x,
              y: parentRect.y,
              width: parentRect.width,
              height: parentRect.height,
            },
            display: parentStyle?.display,
            visibility: parentStyle?.visibility,
            opacity: parentStyle?.opacity,
          }
        : null,
    }
  })

  console.log(`LOGO_STATE=${JSON.stringify(state)}`)
  console.log(`CONSOLE_ERRORS=${JSON.stringify(consoleErrors)}`)
  console.log(`FAILED_REQUESTS=${JSON.stringify(failedRequests)}`)

  const header = page.locator('header').first()
  await header.screenshot({ path: '/tmp/sea-n-shore-logo-browser.png' })

  if (!state.complete || state.naturalWidth <= 0 || state.naturalHeight <= 0) {
    throw new Error('Logo image did not decode in Chromium')
  }

  const naturalAspectRatio = state.naturalWidth / state.naturalHeight
  const renderedAspectRatio = state.rect.width / state.rect.height
  console.log(`LOGO_NATURAL_ASPECT_RATIO=${naturalAspectRatio.toFixed(3)}`)
  console.log(`LOGO_RENDERED_ASPECT_RATIO=${renderedAspectRatio.toFixed(3)}`)

  if (naturalAspectRatio < 2.8) {
    throw new Error(`Header logo asset is not the required horizontal Sea and Shore lockup: intrinsic ${state.naturalWidth}x${state.naturalHeight}`)
  }
  if (state.rect.width < 130 || state.rect.height < 35 || renderedAspectRatio < 2.8) {
    throw new Error(`Header logo is not visibly rendered as a horizontal lockup: ${state.rect.width}x${state.rect.height}`)
  }
  if (state.style.display === 'none' || state.style.visibility === 'hidden' || Number(state.style.opacity) === 0) {
    throw new Error(`Logo is hidden by computed style ${JSON.stringify(state.style)}`)
  }

  console.log('LOGO_BROWSER_RENDER=visible-uploaded-sea-and-shore-lockup')
} finally {
  await browser.close()
}
