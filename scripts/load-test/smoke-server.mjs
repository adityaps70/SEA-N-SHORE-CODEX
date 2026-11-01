// Round P3 / ARCH load test: a throwaway local server for the workflow's plan run, so the whole pipeline (k6, CSV,
// stop-watch, report) is exercised on the runner, for both mixes, without sending a single request to the live site.
import { createServer } from 'node:http'

const port = Number(process.argv[2] || '8099')
const PUBLIC = /^\/(jobs(\/[0-9a-f-]{36})?|learn\/courses\/[a-z0-9-]+|privacy)?$/
const SIGNED_IN = /^\/(home|network|messages|notifications|jobs(\/[0-9a-f-]{36})?|people\/sns-load-test-\d{2}|api\/realtime\/messaging-state)$/
const ACTIONS = new Set(['a'.repeat(42), 'b'.repeat(42)])

createServer((req, res) => {
  const marked = req.headers['x-sns-load-test'] === 'P3'
  const signedIn = /(^|; )sns_cognito_access=smoke-access-\d+/.test(String(req.headers.cookie || ''))
  const path = (req.url || '').split('?')[0]
  const cache = { 'x-cache': path === '/privacy' ? 'Miss from cloudfront' : 'Hit from cloudfront' }
  let body = ''
  req.on('data', (chunk) => { body += chunk })
  req.on('end', () => {
    if (!marked) { res.writeHead(404); res.end('not found'); return }
    if (req.method === 'POST' && path === '/home' && signedIn && ACTIONS.has(String(req.headers['next-action'])) && body.startsWith('[')) {
      res.writeHead(200, { 'content-type': 'text/x-component' })
      res.end('0:["$@1",["smoke"]]\n1:{"ok":true,"page":{"top":{"sessionId":"00000000-0000-4000-8000-000000000001","nextPosition":12}}}\n')
      return
    }
    if (req.method === 'POST' && path === '/api/realtime/ticket' && signedIn) { res.writeHead(200); res.end('{"ticket":"smoke"}'); return }
    if (req.method === 'GET' && signedIn && SIGNED_IN.test(path)) { res.writeHead(200, { 'content-type': 'text/html', ...cache }); res.end('<html>ok</html>'); return }
    if (req.method === 'GET' && !signedIn && PUBLIC.test(path)) { res.writeHead(200, { 'content-type': 'text/html', ...cache }); res.end('<html>ok</html>'); return }
    if (!signedIn && SIGNED_IN.test(path)) { res.writeHead(307, { location: '/auth/sign-in' }); res.end(); return }
    res.writeHead(404); res.end('not found')
  })
}).listen(port, '127.0.0.1', () => console.log(`LOAD_TEST_SMOKE_SERVER port=${port}`))
