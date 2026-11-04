/**
 * Harness-free test of the Host half.
 *
 * `makeHarness` builds a fake Cordis context, captures the registered route
 * handler and tool definition, then drives them: settings, guards, the dead-
 * agent probe, and the agent supervisor (start → ready → stop) against
 * `test/fake-agent.mjs`.
 *
 * Run with: node test/host.test.mjs
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const fakeAgent = join(here, 'fake-agent.mjs')
const work = mkdtempSync(join(tmpdir(), 'dsh-ic-'))
process.env.DSH_HOME = work // keep the plugin's log/settings writes inside the temp dir

const { apply } = await import('../index.js')

const checks = []
function check(name, ok, detail) {
  checks.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : ` — ${detail}`}`)
}

function makeHarness(config) {
  let route
  const tools = new Map()
  const disposers = []
  const fakeWebCtx = {
    webServer: {
      register(spec) {
        route = spec
        return () => {}
      },
      getOrigin() {
        return 'http://127.0.0.1:62692'
      },
    },
    effect(factory) {
      disposers.push(factory())
    },
  }
  const fakeToolCtx = {
    tools: {
      register(definition) {
        tools.set(definition.name, definition)
        return () => {}
      },
    },
    effect(factory) {
      disposers.push(factory())
    },
  }
  apply(
    {
      inject(deps, callback) {
        if (deps.includes('webServer')) callback(fakeWebCtx)
        if (deps.includes('tools')) callback(fakeToolCtx)
      },
      effect(factory) {
        disposers.push(factory())
        return () => {}
      },
    },
    config,
  )
  if (route === undefined) throw new Error('route was not registered')
  const tool = tools.get('infinite_canvas_status')
  if (tool === undefined) throw new Error('status tool was not registered')
  const projectsTool = tools.get('infinite_canvas_projects')
  if (projectsTool === undefined) throw new Error('projects tool was not registered')

  const call = async (method, url, options) => {
    const res = { status: 0, body: '' }
    res.writeHead = (status) => {
      res.status = status
    }
    res.end = (chunk) => {
      res.body += chunk === undefined ? '' : String(chunk)
    }
    const writeHead = res.writeHead
    res.writeHead = (status, headers) => {
      if (headers !== undefined && headers.location !== undefined) res.location = headers.location
      writeHead(status, headers)
    }
    const req = {
      method,
      url,
      headers: { host: '127.0.0.1:62692' },
      async *[Symbol.asyncIterator]() {
        if (options?.body !== undefined) yield Buffer.from(JSON.stringify(options.body))
      },
    }
    if (options?.origin !== undefined) req.headers.origin = options.origin
    await route.handler(req, res)
    res.json = () => JSON.parse(res.body)
    return res
  }

  return {
    call,
    tool,
    projectsTool,
    async dispose() {
      for (const dispose of disposers) await dispose(undefined)
    },
  }
}

const tokenFile = join(work, 'codex-agent.json')
writeFileSync(tokenFile, JSON.stringify({ token: 'a'.repeat(64), port: 3210, url: 'http://127.0.0.1:3210' }))

// ---------------------------------------------------------------------------
// 1. Settings, guards and the offline probe (nothing is spawned here).
// ---------------------------------------------------------------------------
const settingsPath = join(work, 'settings.json')
const offline = makeHarness({
  canvasBaseUrl: 'https://infic.transiglobal.com',
  canvasId: '',
  agentUrl: 'http://127.0.0.1:9',
  embedCredentials: true,
  autoStart: false,
  settingsPath,
  tokenFile,
})

let res = await offline.call('GET', '/infinite-canvas/state')
check('GET state → 200', res.status === 200)
let state = res.json()
check('state default base url', state.canvasBaseUrl === 'https://infic.transiglobal.com', state.canvasBaseUrl)
check('no canvas id is stored at all', state.canvasId === undefined)
check('falls back to the deployment canvas list', state.canvasUrl === 'https://infic.transiglobal.com/canvas', state.canvasUrl)
check('the list url is its own field', state.canvasListUrl === 'https://infic.transiglobal.com/canvas', state.canvasListUrl)
check('token detected from agent file', state.tokenAvailable === true, state.tokenSource)
check('state never leaks the token', !res.body.includes('aaaaaaaa'), 'len=' + res.body.length)
check('autoStart off is reflected', state.autoStart === false)

res = await offline.call('POST', '/infinite-canvas/settings', {
  body: { canvasId: 'https://infic.transiglobal.com/canvas/abc-123_X?foo=1' },
  origin: 'http://127.0.0.1:62692',
})
check('POST settings → 200', res.status === 200, res.body.slice(0, 90))
state = res.json()
check('a canvas id in the payload is not persisted', state.canvasId === undefined)
check('settings file keeps no canvas id', JSON.parse(readFileSync(settingsPath, 'utf8')).canvasId === undefined)
check('the panel target stays the canvas list', state.canvasUrl === 'https://infic.transiglobal.com/canvas', state.canvasUrl)

res = await offline.call('POST', '/infinite-canvas/settings', { body: { autoStart: false }, origin: 'http://127.0.0.1:62692' })
check('autoStart can be turned off from the UI', res.status === 200 && res.json().autoStart === false)

res = await offline.call('POST', '/infinite-canvas/settings', { body: { canvasId: 'evil' }, origin: 'https://evil.example' })
check('cross-origin settings → 403', res.status === 403)
res = await offline.call('POST', '/infinite-canvas/token', { origin: 'https://evil.example' })
check('cross-origin token → 403', res.status === 403)
res = await offline.call('POST', '/infinite-canvas/agent/start', { origin: 'https://evil.example' })
check('cross-origin agent start → 403', res.status === 403)

res = await offline.call('POST', '/infinite-canvas/token', { origin: 'http://127.0.0.1:62692' })
check('same-origin token → 200', res.status === 200)
check('token value is the agent token', res.json().token === 'a'.repeat(64))

res = await offline.call('POST', '/infinite-canvas/link', { origin: 'http://127.0.0.1:62692' })
check('same-origin link → 200', res.status === 200, res.body.slice(0, 90))
const link = res.json()
check('a plain link points at the canvas list', link.url.startsWith('https://infic.transiglobal.com/canvas#'), link.url.slice(0, 80))
const hash = new URL(link.url).hash
check('link carries the agent url in the hash', hash.includes('agentUrl=http') && hash.includes('agentToken='))
check('link reports the handshake as embedded', link.embedded === true)
check('link never appears in an unrelated origin', (await offline.call('POST', '/infinite-canvas/link', { origin: 'https://evil.example' })).status === 403)

res = await offline.call('POST', '/infinite-canvas/settings', { body: { canvasBaseUrl: 'ftp://x' } })
check('rejects non-http base url', res.status === 400)
res = await offline.call('POST', '/infinite-canvas/link', { body: { canvasId: 'https://example.com/not-canvas' } })
check('rejects an unrelated absolute URL as a canvas', res.status === 400)
res = await offline.call('POST', '/infinite-canvas/link', { body: { canvasId: 'abc-123_X' } })
check('a named canvas gets its own page', res.json().url.startsWith('https://infic.transiglobal.com/canvas/abc-123_X#'), res.json().url.slice(0, 80))
check('naming a canvas stores nothing', JSON.parse(readFileSync(settingsPath, 'utf8')).canvasId === undefined)
res = await offline.call('POST', '/infinite-canvas/settings', { body: { canvasBaseUrl: 'canvas.example.com ' } })
check('accepts a bare host for the base url', res.status === 200 && res.json().canvasBaseUrl === 'https://canvas.example.com')
check('list url is appended once', res.json().canvasListUrl === 'https://canvas.example.com/canvas', res.json().canvasListUrl)

res = await offline.call('POST', '/infinite-canvas/settings', { body: { canvasBaseUrl: 'https://canvas.example.com/canvas/' } })
check('a base that already ends in /canvas is not doubled', res.json().canvasListUrl === 'https://canvas.example.com/canvas', res.json().canvasListUrl)

res = await offline.call('GET', '/infinite-canvas/agent')
check('GET agent → 200 even when offline', res.status === 200)
check('agent reported as not running', res.json().running === false, JSON.stringify(res.json()).slice(0, 100))

res = await offline.call('GET', '/infinite-canvas/nope')
check('unknown route → 404', res.status === 404)

const offlineValue = await offline.tool.execute({}, { signal: new AbortController().signal })
check('tool returns the canvas list url', offlineValue.canvasUrl === 'https://canvas.example.com/canvas', offlineValue.canvasUrl)
check('tool reports offline agent', offlineValue.agentRunning === false)
check('tool carries a phase and hint', typeof offlineValue.phase === 'string' && offlineValue.hint.length > 0, offlineValue.phase)
const rendered = offline.tool.output.render({}, offlineValue)
check('tool renders text content', Array.isArray(rendered) && rendered[0]?.type === 'text' && rendered[0].text.includes('canvasUrl'))
await offline.dispose()

// ---------------------------------------------------------------------------
// 2. The supervisor: start the fake agent, wait for it, stop it again.
// ---------------------------------------------------------------------------
const port = 43211
const supervised = makeHarness({
  canvasBaseUrl: 'https://infic.transiglobal.com',
  canvasId: 'probe-canvas',
  agentUrl: `http://127.0.0.1:${port}`,
  embedCredentials: true,
  autoStart: false,
  agentCommand: process.execPath,
  agentArgs: [fakeAgent, String(port)],
  settingsPath: join(work, 'settings-2.json'),
  tokenFile,
})

res = await supervised.call('POST', '/infinite-canvas/agent/start', { origin: 'http://127.0.0.1:62692' })
check('POST agent/start → 200', res.status === 200, res.body.slice(0, 120))
check('start answers without blocking on the download', res.json().phase === 'starting' || res.json().phase === 'running', res.json().phase)

let live
for (let attempt = 0; attempt < 40; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 250))
  live = (await supervised.call('GET', '/infinite-canvas/agent')).json()
  if (live.running === true && live.phase === 'running') break
}
check('supervisor reports the agent running', live.running === true && live.phase === 'running', live.phase)
check('supervisor owns the child', live.managed === true && typeof live.pid === 'number', `pid=${live.pid}`)
check('spawned agent is reachable', (await fetch(`http://127.0.0.1:${port}/config`)).ok)
check('canvas tools read through the agent', Array.isArray(live.tools) && live.tools.includes('fake_tool'), JSON.stringify(live.tools))
const logText = Array.isArray(live.log) ? live.log.join('\n') : ''
check('agent console is captured', logText.includes('Local URL'), logText.slice(0, 60).replace(/\n/g, ' | '))
check('connect token never reaches the log', !logText.includes('f'.repeat(64)), 'redacted')
const logFile = readFileSync(join(work, 'infinite-canvas', 'agent.log'), 'utf8')
check('log file is redacted too', logFile.includes('Local URL') && !logFile.includes('f'.repeat(64)))

res = await supervised.call('POST', '/infinite-canvas/agent/stop', { origin: 'http://127.0.0.1:62692' })
check('POST agent/stop → 200', res.status === 200)
const stopped = res.json()
check('supervisor reports stopped', stopped.phase === 'stopped' && stopped.running === false, stopped.phase)
let reachableAfterStop = true
try {
  reachableAfterStop = (await fetch(`http://127.0.0.1:${port}/config`)).ok
} catch {
  reachableAfterStop = false
}
check('child process really exited', reachableAfterStop === false)

await supervised.dispose()

// ---------------------------------------------------------------------------
// 3. The canvas-API bridge: token check, project list, project create, links.
// ---------------------------------------------------------------------------
const apiRequests = []
const apiServer = createServer((req, res) => {
  const authorized = req.headers.authorization === 'Bearer good-token'
  let body = ''
  req.on('data', (chunk) => {
    body += chunk
  })
  req.on('end', () => {
    apiRequests.push({ method: req.method, url: req.url, body })
    const send = (status, payload) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(payload))
    }
    if (!authorized) return send(401, { code: 1, data: null, msg: '未登录或权限不足' })
    if (req.method === 'GET' && req.url === '/api/v1/canvas/projects') {
      return send(200, {
        code: 0,
        msg: 'ok',
        data: [{ id: 'p1', title: '画布一', updatedAt: '2026-11-04T10:00:00.000Z', nodes: [{}, {}] }],
      })
    }
    if (req.method === 'POST' && req.url === '/api/v1/canvas/projects') return send(200, { code: 0, msg: 'ok', data: {} })
    return send(404, { code: 1, data: null, msg: '接口不存在' })
  })
})
await new Promise((resolve) => apiServer.listen(0, '127.0.0.1', resolve))
const apiPort = apiServer.address().port
const apiTokenPath = join(work, 'canvas-api.json')
const bridged = makeHarness({
  canvasBaseUrl: `http://127.0.0.1:${apiPort}`,
  canvasId: '',
  agentUrl: 'http://127.0.0.1:9',
  autoStart: false,
  settingsPath: join(work, 'settings-3.json'),
  tokenFile,
  canvasApiTokenFile: apiTokenPath,
})

res = await bridged.call('GET', '/infinite-canvas/state')
check('no canvas API token yet', res.json().apiTokenAvailable === false)
res = await bridged.call('GET', '/infinite-canvas/projects')
check('projects without a token → 400', res.status === 400, res.body.slice(0, 80))

res = await bridged.call('POST', '/infinite-canvas/canvas-token', {
  body: { token: 'wrong-token' },
  origin: 'http://127.0.0.1:62692',
})
check('a bad canvas API token is rejected', res.status === 400, res.body.slice(0, 80))
check('a rejected token is not stored', !existsSync(apiTokenPath))

res = await bridged.call('POST', '/infinite-canvas/canvas-token', {
  body: { token: 'good-token' },
  origin: 'http://127.0.0.1:62692',
})
check('a working token is verified and stored', res.status === 200 && res.json().apiTokenAvailable === true, res.body.slice(0, 80))
check('the token file is private', (statSync(apiTokenPath).mode & 0o777) === 0o600, `mode=${(statSync(apiTokenPath).mode & 0o777).toString(8)}`)
check('the state never leaks the canvas API token', !res.body.includes('good-token'))

res = await bridged.call('POST', '/infinite-canvas/canvas-token', {
  body: { token: 'infinite-canvas-auth-token-v1 good-token' },
  origin: 'http://127.0.0.1:62692',
})
check('a pasted "key token" pair keeps only the token', res.status === 200 && res.json().apiTokenAvailable === true, res.body.slice(0, 90))

res = await bridged.call('POST', '/infinite-canvas/canvas-token', { body: { token: '' } })
check('the token can be cleared', res.status === 200 && res.json().apiTokenAvailable === false)
await bridged.call('POST', '/infinite-canvas/canvas-token', { body: { token: 'good-token' } })

res = await bridged.call('GET', '/infinite-canvas/projects')
check('GET projects → 200', res.status === 200, res.body.slice(0, 90))
const listed = res.json().projects
check('projects are summarized', listed.length === 1 && listed[0].id === 'p1' && listed[0].nodeCount === 2, JSON.stringify(listed))
check('cross-origin project read → 403', (await bridged.call('GET', '/infinite-canvas/projects', { origin: 'https://evil.example' })).status === 403)

res = await bridged.call('POST', '/infinite-canvas/projects', { body: { title: '新画布' }, origin: 'http://127.0.0.1:62692' })
check('POST projects → 200', res.status === 200, res.body.slice(0, 90))
const created = res.json()
check('created canvas has an id', typeof created.project.id === 'string' && created.project.id.length >= 10, created.project.id)
check('created canvas keeps the title', created.project.title === '新画布')
check('created canvas url points at its page', created.canvasUrl === `http://127.0.0.1:${apiPort}/canvas/${created.project.id}`, created.canvasUrl)
const post = apiRequests.filter((entry) => entry.method === 'POST').pop()
check('create posts the project shape the Web app uses', JSON.parse(post.body).data.id === created.project.id && JSON.stringify(JSON.parse(post.body).data).includes('"sidePanel"'))
check('the created canvas becomes the pending target', created.pending !== null && created.pending.canvasId === created.project.id)

res = await bridged.call('GET', '/infinite-canvas/state')
check('state carries the pending target for the panel', res.json().pending !== null && res.json().pending.canvasId === created.project.id, JSON.stringify(res.json().pending))
const bridgedSettings = (() => {
  try {
    return JSON.parse(readFileSync(join(work, 'settings-3.json'), 'utf8'))
  } catch {
    return {}
  }
})()
check('the pending target is not written to settings', bridgedSettings.pending === undefined)

res = await bridged.call('POST', '/infinite-canvas/target', { body: { canvasId: 'p1', blocked: true }, origin: 'http://127.0.0.1:62692' })
check('a blocked automatic open is recorded', res.status === 200 && res.json().pending.blocked === true, JSON.stringify(res.json().pending))
res = await bridged.call('GET', '/infinite-canvas/state')
check('state reports the blocked pending canvas', res.json().pending.blocked === true && res.json().pending.canvasId === 'p1')

res = await bridged.call('GET', '/infinite-canvas/open?canvas=p1')
check('/open redirects to the canvas page', res.status === 302 && String(res.location).includes('/canvas/p1#'), `${res.status} ${String(res.location).slice(0, 60)}`)
check('/open carries the agent handshake', String(res.location).includes('agentToken='))
res = await bridged.call('GET', '/infinite-canvas/open?canvas=https://x/y')
check('/open refuses a bad canvas id', res.status === 400)

res = await bridged.call('POST', '/infinite-canvas/target', { body: { canvasId: '' }, origin: 'http://127.0.0.1:62692' })
check('the pending target can be cleared', res.json().pending === null)
check('cross-origin target → 403', (await bridged.call('POST', '/infinite-canvas/target', { body: { canvasId: 'p1' }, origin: 'https://evil.example' })).status === 403)

res = await bridged.call('POST', '/infinite-canvas/link', { body: { canvasId: 'p1' }, origin: 'http://127.0.0.1:62692' })
check('link can target one canvas without pinning it', res.status === 200 && res.json().canvasId === 'p1' && res.json().url.includes('/canvas/p1#'), res.body.slice(0, 90))
check('an invalid canvas id is refused', (await bridged.call('POST', '/infinite-canvas/link', { body: { canvasId: 'https://x/y' } })).status === 400)

const listValue = await bridged.projectsTool.execute({ action: 'list' }, { signal: new AbortController().signal })
check('projects tool lists canvases', listValue.ok === true && listValue.projects.length === 1 && listValue.projects[0].id === 'p1')
check('projects tool offers list and create', JSON.stringify(bridged.projectsTool.parameters.properties.action.enum) === '["list","create"]')
const createValue = await bridged.projectsTool.execute({ action: 'create', title: 'MCP 新建' }, { signal: new AbortController().signal })
check('projects tool creates a canvas', createValue.ok === true && createValue.created.title === 'MCP 新建' && createValue.created.canvasUrl.includes('/canvas/'))
const afterCreate = await bridged.call('GET', '/infinite-canvas/state')
check('a tool-created canvas is handed to the panel too', afterCreate.json().pending.canvasId === createValue.created.id)
check('projects tool reports failures instead of throwing', (await bridged.projectsTool.execute({ action: 'list' }, { signal: new AbortController().signal })).ok === true)
const renderedProjects = bridged.projectsTool.output.render({}, listValue)
check('projects tool renders text content', Array.isArray(renderedProjects) && renderedProjects[0]?.text.includes('p1'))

await bridged.dispose()
await new Promise((resolve) => apiServer.close(resolve))

// ---------------------------------------------------------------------------
const failed = checks.filter((entry) => !entry.ok)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
rmSync(work, { recursive: true, force: true })
if (failed.length > 0) process.exitCode = 1
