import assert from 'node:assert/strict'

// Domain move (seanshore.net), Phase 1 check B: a browser E2E pointed at a site (the canonical one or an alias such
// as https://seanshore.net) must stay on that host for every page it opens. A redirect to another host would let the
// journey pass on the wrong site, so each main-frame navigation off the expected host is recorded and the run fails.
// Hosts only are printed, never a path or query.
export function stayOnSite(browser, siteUrl) {
  const expected = new URL(siteUrl).host
  const offSite = new Set()
  const newContext = browser.newContext.bind(browser)
  browser.newContext = async (...args) => {
    const context = await newContext(...args)
    context.on('page', (page) => {
      page.on('framenavigated', (frame) => {
        if (frame !== page.mainFrame()) return
        const url = frame.url()
        if (!/^https?:\/\//.test(url)) return
        const host = new URL(url).host
        if (host !== expected) offSite.add(host)
      })
    })
    return context
  }
  return function assertStayedOnSite() {
    assert.ok(offSite.size === 0, `The browser left ${expected} for: ${[...offSite].join(', ')}`)
    console.log('E2E_SITE_HOST_STAYED=' + expected)
  }
}
