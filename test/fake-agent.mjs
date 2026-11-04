/**
 * Minimal stand-in for the local canvas-agent service: the two endpoints the
 * plugin talks to, plus the console lines the real agent prints (so log
 * redaction can be checked).
 */
import { createServer } from 'node:http'

const port = Number(process.argv[2] ?? 43210)
const token = 'f'.repeat(64)

const server = createServer((request, response) => {
  if (typeof request.url === 'string' && request.url.startsWith('/config')) {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ url: `http://127.0.0.1:${port}`, hasToken: true }))
    return
  }
  if (typeof request.url === 'string' && request.url.startsWith('/tools')) {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify([{ name: 'fake_tool', description: 'fake' }]))
    return
  }
  response.writeHead(404, { 'content-type': 'application/json' })
  response.end('{}')
})

server.listen(port, '127.0.0.1', () => {
  console.log(`Local URL: http://127.0.0.1:${port}`)
  console.log(`Connect token: ${token}`)
})

process.on('SIGTERM', () => server.close(() => process.exit(0)))
process.on('SIGINT', () => server.close(() => process.exit(0)))
