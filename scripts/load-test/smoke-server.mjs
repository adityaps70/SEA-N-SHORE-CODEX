// Round P3 load test: a throwaway local server for the workflow's plan run, so the whole pipeline (k6, CSV,
// stop-watch, report) is exercised on the runner without sending a single request to the live site.
import { createServer } from 'node:http'

const port = Number(process.argv[2] || '8099')
const PAGES = /^\/(jobs(\/[0-9a-f-]{36})?|learn\/courses\/[a-z0-9-]+|privacy)?$/
createServer((req, res) => {
  const ok = PAGES.test(req.url || '') && req.headers['x-sns-load-test'] === 'P3'
  res.writeHead(ok ? 200 : 404, { 'content-type': 'text/html', 'x-cache': req.url === '/privacy' ? 'Miss from cloudfront' : 'Hit from cloudfront' })
  res.end(ok ? '<html>ok</html>' : 'not found')
}).listen(port, '127.0.0.1', () => console.log(`LOAD_TEST_SMOKE_SERVER port=${port}`))
