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
  const skills = new Map()
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
        if (deps.includes('skills')) callback({
          effect: fakeToolCtx.effect,
          skills: { register(skill) { skills.set(skill.name, skill); return () => skills.delete(skill.name) } },
        })
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
    tools,
    skills,
    async dispose() {
      for (const dispose of disposers) await dispose(undefined)
    },
  }
}

let count = 0
const tokenFile = join(work, 'codex-agent.json')
writeFileSync(tokenFile, JSON.stringify({ token: 'a'.repeat(64) }))
let projects = [{ id: 'p1', title: 'Original', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', nodes: [], connections: [], untouched: 'preserve' }]
let apiFailure = null
const calls = []
const server = createServer((req, res) => {
  let raw = ''
  req.on('data', (part) => raw += part)
  req.on('end', () => {
    calls.push({ method: req.method, path: req.url, authorization: req.headers.authorization })
    const send = (status, code, data, msg = 'ok') => { res.writeHead(status, { 'content-type': 'application/json', 'retry-after': '2' }); res.end(JSON.stringify({ code, data, msg })) }
    if (apiFailure) return send(apiFailure, 1, null, 'backend failure')
    if (req.headers.authorization !== 'Bearer ic_good_test_key') return send(401, 1, null, 'invalid key')
    if (req.method === 'GET' && req.url === '/api/v1/canvas/projects') return send(200, 0, projects)
    if (req.method === 'POST' && req.url === '/api/v1/canvas/projects') {
      const project = JSON.parse(raw).data
      projects = [...projects.filter((p) => p.id !== project.id), project]
      return send(200, 0, project)
    }
    if (req.url === '/api/v1/videos') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ id: 'video-task-1', status: 'queued' })) }
    if (req.url === '/api/v1/videos/video-task-1') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ id: 'video-task-1', status: 'failed', error: { message: 'provider failed' } })) }
    if (req.url === '/api/v1/canvas/projects/delete') { const ids = JSON.parse(raw).ids; projects = projects.filter((p) => !ids.includes(p.id)); return send(200, 0, { deleted: true }) }
    send(404, 1, null, 'missing route')
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const baseUrl = `http://127.0.0.1:${server.address().port}`
const apiKeyFile = join(work, 'canvas-api.json')
const harness = makeHarness({ canvasBaseUrl: baseUrl, agentUrl: 'http://127.0.0.1:9', autoStart: false, tokenFile, settingsPath: join(work, 'settings.json'), canvasApiKeyFile: apiKeyFile })
let res = await harness.call('GET', '/infinite-canvas/state')
check('state excludes both API and Agent secrets', !res.body.includes('a'.repeat(64)) && res.json().apiKeyAvailable === false)
check('native backend tools are registered without a MCP bridge', ['infinite_canvas_nodes', 'infinite_canvas_media', 'infinite_canvas_catalog'].every((name) => harness.tools.has(name)))
check('the operation skill explains the independent launcher', harness.skills.get('infinite-canvas')?.content.includes('stopped web Agent is not an API failure'))
res = await harness.call('POST', '/infinite-canvas/canvas-key', { body: { key: 'browser-session-token' } })
check('session tokens are rejected', res.status === 400 && !existsSync(apiKeyFile))
res = await harness.call('POST', '/infinite-canvas/canvas-key', { body: { key: 'ic_wrong' } })
check('invalid keys are verified before saving', res.status === 400 && !existsSync(apiKeyFile))
res = await harness.call('POST', '/infinite-canvas/canvas-key', { body: { key: 'Bearer ic_good_test_key', canvasBaseUrl: baseUrl } })
check('valid API key saves without leaking its value', res.status === 200 && res.json().apiKeyAvailable && !res.body.includes('ic_good_test_key'))
check('key file is private and bound to the deployment', (statSync(apiKeyFile).mode & 0o777) === 0o600 && JSON.parse(readFileSync(apiKeyFile)).baseUrl === baseUrl)
res = await harness.call('GET', '/infinite-canvas/connection')
check('backend connectivity is checked independently', res.json().connected === true)
const status = await harness.tool.execute({})
check('backend tools stay usable with the web Agent stopped', status.backend.connected && status.webAgent.optional && status.webAgent.phase === 'idle')
let listed = await harness.projectsTool.execute({ action: 'list' })
check('project list includes revisions and viewing URLs', listed.ok && listed.projects[0].revision && listed.projects[0].canvasUrl.includes('/canvas/p1'))
const edited = await harness.tools.get('infinite_canvas_nodes').execute({ action: 'create_text', canvasId: 'p1', expectedRevision: listed.projects[0].revision, title: 'Headless edit', content: 'API without browser' })
check('node write runs through the real HTTP API without Agent', edited.ok && projects[0].nodes[0].metadata.content === 'API without browser' && projects[0].untouched === 'preserve')
const stale = await harness.tools.get('infinite_canvas_nodes').execute({ action: 'rename', canvasId: 'p1', expectedRevision: listed.projects[0].revision, nodeId: edited.nodeId, title: 'stale' })
check('tool wraps version conflict as an actionable failure', stale.ok === false && stale.error.includes('expectedRevision'))
const created = await harness.projectsTool.execute({ action: 'create', title: 'Created headlessly' })
check('creation is read back and does not schedule browser navigation', created.ok && created.created.revision && !(await harness.call('GET', '/infinite-canvas/state')).json().pending)
const opened = await harness.projectsTool.execute({ action: 'open', canvasId: 'p1' })
check('open only returns an optional plain viewing URL', opened.ok && opened.browserRequired === false && !opened.canvasUrl.includes('agentToken'))
res = await harness.call('POST', '/infinite-canvas/link', { body: { canvasId: 'p1' } })
check('default viewing links contain no Agent handshake', !res.json().url.includes('agentToken'))
res = await harness.call('POST', '/infinite-canvas/link', { body: { canvasId: 'p1', webAgent: true } })
check('explicit web-Agent links retain the convenience handshake', res.json().url.includes('agentToken=') && !res.body.includes('ic_good_test_key'))
for (const path of ['state', 'projects', 'agent', 'connection']) {
  check(`cross-origin ${path} is rejected`, (await harness.call('GET', `/infinite-canvas/${path}`, { origin: 'https://evil.example' })).status === 403)
}
check('cross-origin key changes are rejected', (await harness.call('POST', '/infinite-canvas/canvas-key', { origin: 'https://evil.example', body: { key: 'ic_fake' } })).status === 403)
const beforeMedia = await harness.tools.get('infinite_canvas_nodes').execute({ action: 'summary', canvasId: 'p1' })
const mediaNode = await harness.tools.get('infinite_canvas_nodes').execute({ action: 'create_media', canvasId: 'p1', expectedRevision: beforeMedia.project.revision, kind: 'video', title: 'Fake video only' })
const submitted = await harness.tools.get('infinite_canvas_media').execute({ action: 'submit', canvasId: 'p1', nodeId: mediaNode.nodeId, expectedRevision: mediaNode.project.revision, channelId: 'test-channel', request: { model: 'fake-model', prompt: 'test' } })
check('raw video task responses are accepted through the real HTTP adapter', submitted.ok && submitted.task.id === 'video-task-1')
const synchronized = await harness.tools.get('infinite_canvas_media').execute({ action: 'sync', canvasId: 'p1', nodeId: mediaNode.nodeId, expectedRevision: submitted.project.revision })
check('a failed video task can still sync its error instead of being treated as a malformed API response', synchronized.ok && projects.find((p) => p.id === 'p1').nodes.find((n) => n.id === mediaNode.nodeId).metadata.status === 'error')
for (const [code, hint] of [[401, '已撤销'], [403, '权限不足'], [429, '频繁'], [503, 'backend failure']]) {
  apiFailure = code
  const value = await harness.projectsTool.execute({ action: 'list' })
  check(`HTTP ${code} is distinguishable`, !value.ok && value.error.includes(hint))
}
apiFailure = null
const before = calls.length
await harness.call('POST', '/infinite-canvas/settings', { body: { canvasBaseUrl: 'https://other.example' } })
listed = await harness.projectsTool.execute({ action: 'list' })
check('changing deployment never sends its old key to another origin', !listed.ok && calls.length === before)
check('remote plaintext Key transport is rejected', (await harness.call('POST', '/infinite-canvas/canvas-key', { body: { key: 'ic_fake', canvasBaseUrl: 'http://example.com' } })).status === 400)
await harness.call('POST', '/infinite-canvas/settings', { body: { canvasBaseUrl: baseUrl } })
check('invalid addresses are rejected', (await harness.call('POST', '/infinite-canvas/settings', { body: { canvasBaseUrl: 'ftp://example.com' } })).status === 400)
await harness.dispose()
check('runtime skill is removed on plugin unload', harness.skills.size === 0)
server.close()

// The convenience launcher remains functional but is not involved in the tests above.
const managed = makeHarness({ canvasBaseUrl: baseUrl, agentUrl: 'http://127.0.0.1:43211', autoStart: false, agentCommand: process.execPath, agentArgs: [fakeAgent, '43211'], tokenFile, settingsPath: join(work, 'launcher.json') })
res = await managed.call('POST', '/infinite-canvas/agent/start')
check('optional launcher can start the local web Agent', res.status === 200 && res.json().running)
res = await managed.call('GET', '/infinite-canvas/agent')
check('launcher captures redacted logs', !JSON.stringify(res.json().log).includes('f'.repeat(64)))
res = await managed.call('POST', '/infinite-canvas/agent/stop')
check('optional launcher can stop its managed process', res.json().phase === 'stopped')
await managed.dispose()
rmSync(work, { recursive: true, force: true })
const failed = checks.filter((v) => !v.ok)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
if (failed.length) process.exitCode = 1
