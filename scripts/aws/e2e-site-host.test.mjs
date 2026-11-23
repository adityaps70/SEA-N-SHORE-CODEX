import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { stayOnSite } from './e2e-site-host.mjs'

// A fake browser: each context emits 'page', each page emits 'framenavigated' for its main frame or a child frame.
function fakeBrowser() {
  const pages = []
  return {
    pages,
    async newContext() {
      const context = new EventEmitter()
      context.newPage = async () => {
        const page = new EventEmitter()
        const main = { url: () => page.current }
        page.mainFrame = () => main
        page.go = (url, frame = main) => { if (frame === main) page.current = url; else frame.url = () => url; page.emit('framenavigated', frame) }
        pages.push(page)
        context.emit('page', page)
        return page
      }
      return context
    },
  }
}

test('passes when every main-frame navigation stays on the site host', async () => {
  const browser = fakeBrowser()
  const assertStayed = stayOnSite(browser, 'https://seanshore.net')
  const page = await (await browser.newContext()).newPage()
  page.go('about:blank')
  page.go('https://seanshore.net/auth/sign-in')
  page.go('https://seanshore.net/home?x=1')
  page.go('https://example.org/embed', { url: () => '' }) // a child frame elsewhere is fine
  assertStayed()
})

test('fails when the browser is sent to another host, naming the host only', async () => {
  const browser = fakeBrowser()
  const assertStayed = stayOnSite(browser, 'https://seanshore.net')
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage()
  page.go('https://seanshore.net/auth/sign-in')
  page.go('https://seanshore.in/home?member=secret-path')
  assert.throws(() => assertStayed(), (error) => /left seanshore\.net for: seanshore\.in$/.test(error.message) && !error.message.includes('secret-path'))
})
