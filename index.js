/** Backend API tools and an independent, optional launcher for the web app's local Agent. */
import { randomBytes } from 'node:crypto'
import { createCanvasOperations, revisionOf } from './canvas-operations.js'
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const name = 'dsh-infinite-canvas'

/** Route prefix owned by this bundle; nothing else may register under it. */
const ROUTE_PREFIX = '/infinite-canvas'

/** Agent service the official `canvas-agent` CLI listens on by default. */
const DEFAULT_AGENT_URL = 'http://127.0.0.1:3210'

/** Default deployment of the API Key-enabled TNTest fork. */
const DEFAULT_CANVAS_BASE_URL = 'https://infic.transiglobal.com'

/** Settings file shape version; a different version is ignored rather than guessed at. */
const SETTINGS_VERSION = 1

/** Default title of a canvas created through Host, matching the Web app. */
const NEW_CANVAS_TITLE = '未命名画布'
/** Canvas deployment REST API. */
const CANVAS_API_PREFIX = '/api/v1'
const CANVAS_API_TIMEOUT_MS = 12_000

const PROBE_TIMEOUT_MS = 2500
/** Refuse absurd request bodies before buffering them. */
const MAX_BODY_BYTES = 64 * 1024
/** First start may have to download the package, so the wait is generous. */
const AGENT_READY_TIMEOUT_MS = 150_000
const WATCHDOG_INTERVAL_MS = 15_000
/** Consecutive automatic restarts before the supervisor gives up. */
const MAX_AUTO_RESTARTS = 3
/** Kept in memory for the panel; the file keeps everything. */
const LOG_LINES = 60

const DEFAULT_AGENT_COMMAND = 'npx'
const DEFAULT_AGENT_ARGS = Object.freeze(['-y', '@tigerowo/canvas-agent@latest'])

function dshHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv
  return join(homedir(), '.dsh')
}

function stateDirectory() {
  return join(dshHome(), 'infinite-canvas')
}

function settingsFilePath(config) {
  const configured = typeof config?.settingsPath === 'string' ? config.settingsPath.trim() : ''
  if (configured !== '') return configured
  return join(stateDirectory(), 'settings.json')
}

/** Token file written by the official agent on its first start. */
function agentTokenFile(config) {
  const configured = typeof config?.tokenFile === 'string' ? config.tokenFile.trim() : ''
  if (configured !== '') return configured
  return join(homedir(), '.infinite-canvas', 'codex-agent.json')
}

/** Locally stored API Key, sent only to its verified deployment. */
function canvasApiFile(config) {
  const configured = typeof config?.canvasApiKeyFile === 'string' ? config.canvasApiKeyFile.trim() : ''
  if (configured !== '') return configured
  return join(stateDirectory(), 'canvas-api.json')
}

/** Only dedicated user API keys are accepted, never browser session tokens. */
function normalizeApiKey(input) {
  if (typeof input !== 'string') return ''
  return input.trim().replace(/^bearer\s+/i, '')
}

function validApiKey(key) {
  return /^ic_[A-Za-z0-9_-]+$/.test(key)
}

/** Bind stored keys to the deployment they were verified against. */
function resolveCanvasApiKey(config) {
  const file = canvasApiFile(config)
  const baseUrl = resolveSettings(config).canvasBaseUrl
  const fromEnv = normalizeApiKey(process.env.CANVAS_API_KEY)
  if (validApiKey(fromEnv) && baseUrl === normalizeBaseUrl(config?.canvasBaseUrl ?? DEFAULT_CANVAS_BASE_URL)) {
    return { key: fromEnv, source: 'env', file }
  }
  const saved = readJsonFile(file)
  const key = normalizeApiKey(saved?.key)
  if (validApiKey(key) && saved.baseUrl === baseUrl) return { key, source: 'file', file }
  return { key: '', source: 'none', file }
}

/** API keys only travel in Authorization headers, without following redirects. */
async function canvasApi(config, request) {
  const key = request.key ?? resolveCanvasApiKey(config).key
  if (!validApiKey(key)) throw new Error('请在「无限画布」设置中配置 ic_ 开头的用户 API Key')
  const baseUrl = request.baseUrl ?? resolveSettings(config).canvasBaseUrl
  const target = new URL(`${baseUrl}${request.public ? '/api' : CANVAS_API_PREFIX}${request.path}`)
  if (target.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)) {
    throw new Error('API Key 需要 HTTPS 站点地址（本机测试除外）')
  }
  const headers = request.public ? {} : { authorization: `Bearer ${key}` }
  if (request.channelId) headers['X-Model-Channel-ID'] = request.channelId
  if (request.clientTaskId) headers['X-Client-Video-Task-ID'] = request.clientTaskId
  if (request.sourceId) { headers['X-Video-Task-Source'] = 'canvas'; headers['X-Video-Task-Source-ID'] = request.sourceId }
  if (request.body !== undefined) headers['content-type'] = 'application/json'
  let response
  try {
    response = await fetch(target, {
      method: request.method,
      headers,
      redirect: 'error',
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
      signal: AbortSignal.timeout(CANVAS_API_TIMEOUT_MS),
    })
  } catch {
    throw new Error('画布站不可达，请检查站点地址与网络；认证请求不允许重定向')
  }
  if (response.status === 401) throw new Error('API Key 无效、已过期或已撤销，请更换 Key')
  if (response.status === 403) throw new Error('API Key 权限不足或请求额度耗尽；读取需 read，保存需 read + write，生成需 generate，资源删除需 delete')
  if (response.status === 429) throw new Error(`API Key 请求过于频繁，请在 ${response.headers.get('retry-after') ?? '60'} 秒后重试`)
  let envelope
  try {
    envelope = await response.json()
  } catch {
    throw new Error(`画布站返回异常（HTTP ${response.status}）`)
  }
  if (!response.ok || envelope?.code !== undefined && envelope.code !== 0 || !request.raw && envelope?.code !== 0 || request.raw && envelope?.error && typeof envelope.status !== 'string') {
    const detail = envelope?.msg ?? envelope?.error?.message
    const message = typeof detail === 'string' ? detail.replaceAll(key, '<key>') : ''
    throw new Error(message || `画布站请求失败（HTTP ${response.status}）`)
  }
  return envelope.code === 0 ? envelope.data : envelope
}

/**
 * The deployment picks up a client-chosen nanoid as the canvas id, exactly like
 * the Web app's own "new canvas" action.
 */
function newCanvasId() {
  return randomBytes(16).toString('base64url').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 21)
}

/** A canvas project shaped like the ones the Web app saves. */
function newCanvasProject(title) {
  const now = new Date().toISOString()
  return {
    id: newCanvasId(),
    title,
    createdAt: now,
    updatedAt: now,
    nodes: [],
    connections: [],
    chatSessions: [],
    activeChatId: null,
    agentConfig: null,
    autoTitlePending: true,
    backgroundMode: 'lines',
    showImageInfo: false,
    viewport: { x: 0, y: 0, k: 1 },
    sidePanel: { open: true, width: 280 },
    agentPanel: { open: false, width: 464 },
  }
}

/** Only the fields a panel or a tool needs, whatever else the API returns. */
function summarizeProject(project) {
  const id = typeof project?.id === 'string' ? project.id : ''
  if (id === '') return undefined
  return {
    id,
    title: typeof project?.title === 'string' ? project.title : '',
    updatedAt: typeof project?.updatedAt === 'string' ? project.updatedAt : '',
    nodeCount: Array.isArray(project?.nodes) ? project.nodes.length : 0,
  }
}

function readJsonFile(path) {
  try {
    if (!existsSync(path)) return undefined
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return parsed !== null && typeof parsed === 'object' ? parsed : undefined
  } catch {
    return undefined
  }
}

/** Write through a sibling temporary file so a crash cannot truncate the settings. */
function writeJsonFile(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const text = `${JSON.stringify(value, null, 2)}\n`
  const temporary = `${path}.${process.pid}.tmp`
  try {
    writeFileSync(temporary, text, { encoding: 'utf8', mode: 0o600 })
    renameSync(temporary, path)
  } catch (error) {
    try {
      writeFileSync(path, text, { encoding: 'utf8', mode: 0o600 })
    } catch {
      throw error
    }
  }
}

/** A normalized http(s) base URL with no trailing slash, or undefined when invalid. */
function normalizeBaseUrl(input) {
  if (typeof input !== 'string') return undefined
  const text = input.trim()
  if (text === '') return undefined
  let url
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`)
  } catch {
    return undefined
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
  if (url.username !== '' || url.password !== '') return undefined
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
}

/**
 * Accept a bare canvas id, a `/canvas/<id>` path, or a full canvas URL and
 * return the id. An empty string clears the selection.
 */
function normalizeCanvasId(input) {
  if (typeof input !== 'string') return undefined
  const text = input.trim()
  if (text === '') return ''
  let candidate = text
  const marker = '/canvas/'
  const at = candidate.lastIndexOf(marker)
  if (at !== -1) candidate = candidate.slice(at + marker.length)
  else if (/^https?:\/\//i.test(candidate)) return undefined
  candidate = candidate.split(/[?#]/)[0] ?? ''
  candidate = candidate.replace(/^\/+/, '').replace(/\/+$/, '')
  if (candidate === '') return ''
  if (!/^[A-Za-z0-9._~-]{1,200}$/.test(candidate)) return undefined
  return candidate
}

function settingsFromFile(config) {
  const path = settingsFilePath(config)
  const stored = readJsonFile(path)
  const usable = stored !== undefined && stored.version === SETTINGS_VERSION ? stored : undefined
  return { path, stored, usable }
}

/**
 * Effective settings: the UI file wins, the patch row's config is the default
 * layer, and the values above are the shipped defaults.
 */
function resolveSettings(config) {
  const { path, stored, usable } = settingsFromFile(config)
  const pick = (key, fallback) => {
    if (usable !== undefined && usable[key] !== undefined) return usable[key]
    if (config?.[key] !== undefined) return config[key]
    return fallback
  }
  const canvasBaseUrl = normalizeBaseUrl(pick('canvasBaseUrl', DEFAULT_CANVAS_BASE_URL)) ?? DEFAULT_CANVAS_BASE_URL
  const agentUrl = normalizeBaseUrl(pick('agentUrl', DEFAULT_AGENT_URL)) ?? DEFAULT_AGENT_URL
  const embedCredentials = pick('embedCredentials', true) !== false
  const autoStart = pick('autoStart', true) !== false
  return { path, stored: usable ?? stored, canvasBaseUrl, agentUrl, embedCredentials, autoStart }
}

/** Token resolution mirrors the agent CLI: environment first, then its saved file. */
function resolveToken(config) {
  const fromEnv = process.env.CANVAS_AGENT_TOKEN
  if (typeof fromEnv === 'string' && fromEnv !== '') {
    return { token: fromEnv, source: 'env', file: agentTokenFile(config) }
  }
  const file = agentTokenFile(config)
  const saved = readJsonFile(file)
  if (saved !== undefined && typeof saved.token === 'string' && saved.token !== '') {
    return { token: saved.token, source: 'agent-file', file, saved }
  }
  return { token: '', source: 'none', file }
}

/**
 * The deployment's own canvas list — `/canvas`, not the site root. It is where
 * a canvas gets picked in the page itself, so no id has to be stored up front.
 */
function canvasListUrl(settings) {
  const base = settings.canvasBaseUrl.replace(/\/+$/, '')
  return base.endsWith('/canvas') ? base : `${base}/canvas`
}

/**
 * A specific canvas page, or the deployment's canvas list for an empty id. No
 * canvas is ever remembered in settings: the id comes from the person naming it
 * or from the deployment API, never from stored state.
 */
function canvasPageUrl(settings, canvasId) {
  const base = settings.canvasBaseUrl.replace(/\/+$/, '')
  return canvasId === '' ? canvasListUrl(settings) : `${base}/canvas/${canvasId}`
}

/**
 * The browser URL that connects itself: the canvas page reads `agentUrl` and
 * `agentToken` from its own hash. An empty token, or `embedCredentials` off,
 * yields the plain canvas address for a manual handshake.
 */
function connectLinkOf(settings, token, canvasId) {
  const target = new URL(canvasPageUrl(settings, typeof canvasId === 'string' ? canvasId : ''))
  const embed = settings.embedCredentials === true && token !== ''
  if (embed) {
    target.hash = new URLSearchParams({ agentUrl: settings.agentUrl, agentToken: token }).toString()
  }
  return { url: target.toString(), embedded: embed }
}

/** What the Web panel needs; never includes the token. */
function snapshot(config) {
  const settings = resolveSettings(config)
  const token = resolveToken(config)
  const apiKey = resolveCanvasApiKey(config)
  return {
    canvasBaseUrl: settings.canvasBaseUrl,
    canvasUrl: canvasListUrl(settings),
    canvasListUrl: canvasListUrl(settings),
    agentUrl: settings.agentUrl,
    autoStart: settings.autoStart,
    embedCredentials: settings.embedCredentials,
    tokenAvailable: token.token !== '',
    apiKeyAvailable: apiKey.key !== '',
    apiKeySource: apiKey.source,
    apiKeyRevision: readJsonFile(apiKey.file)?.savedAt ?? '',
  }
}

/** The web launcher only checks service reachability, never the browser's tool session. */
async function probeAgent(agentUrl) {
  try {
    const response = await fetch(`${String(agentUrl).replace(/\/+$/, '')}/config`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const body = await response.json()
    return { running: true, hasToken: body.hasToken === true }
  } catch (error) { return { running: false, error: error.message } }
}

/** Is something already listening at this agent URL? */
async function serviceReachable(agentUrl) {
  try {
    const response = await fetch(`${String(agentUrl).replace(/\/+$/, '')}/config`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    return response.ok
  } catch {
    return false
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Strip anything token-shaped before a log line is kept or written. */
function redactLog(line) {
  return line
    .replace(/ic_[A-Za-z0-9_-]+/g, '<key>')
    .replace(/[0-9a-f]{32,}/gi, '<token>')
    .replace(/(token[^:=]*[:=]\s*)\S+/gi, '$1<token>')
}

/**
 * The child needs its own canvas-agent configuration and an ordinary browser
 * environment, not the Harness's credentials.
 */
function childEnvironment(extra) {
  const env = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (key.startsWith('DSH_')) continue
    if (key.startsWith('CANVAS_AGENT_')) {
      env[key] = value
      continue
    }
    if (/(KEY|TOKEN|SECRET|PASSWD|PASSWORD|CREDENTIAL|AUTH)/i.test(key)) continue
    env[key] = value
  }
  return { ...env, FORCE_COLOR: '0', ...extra }
}

function agentLogPath() {
  return join(stateDirectory(), 'agent.log')
}

const truncatedLogs = new Set()
function appendAgentLog(line) {
  const path = agentLogPath()
  try {
    if (!truncatedLogs.has(path)) {
      truncatedLogs.add(path)
      if (existsSync(path) && statSync(path).size > 512 * 1024) writeFileSync(path, '', 'utf8')
    }
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    appendFileSync(path, `${new Date().toISOString()} ${line}\n`, { encoding: 'utf8', mode: 0o600 })
  } catch {
    // A log file is a convenience; failing to write it must not break the panel.
  }
}

/**
 * Owns the local agent child process.
 *
 * Phases: `idle` (never started), `starting`, `running` (our child, reachable),
 * `external` (something else is listening), `stopping`, `stopped`, `exited`
 * (our child died), `error` (spawn failed or never became reachable).
 */
function createAgentSupervisor(config) {
  const lines = []
  const status = {
    phase: 'idle',
    pid: undefined,
    managed: false,
    error: undefined,
    startedAt: undefined,
    restarts: 0,
  }
  let child
  let stopping = false
  let disposed = false
  let userStopped = false
  let watchdog

  const pushLog = (chunk) => {
    const text = typeof chunk === 'string' ? chunk : String(chunk)
    for (const raw of text.split('\n')) {
      const line = redactLog(raw).trimEnd()
      if (line === '') continue
      lines.push(line)
      if (lines.length > LOG_LINES) lines.shift()
      appendAgentLog(line)
    }
  }

  const state = () => ({
    phase: status.phase,
    pid: status.pid,
    managed: status.managed,
    error: status.error,
    startedAt: status.startedAt,
    restarts: status.restarts,
    command: typeof config?.agentCommand === 'string' && config.agentCommand !== '' ? config.agentCommand : DEFAULT_AGENT_COMMAND,
    log: lines.slice(-8),
    autoStart: resolveSettings(config).autoStart,
  })

  const commandOf = () =>
    typeof config?.agentCommand === 'string' && config.agentCommand.trim() !== ''
      ? config.agentCommand.trim()
      : DEFAULT_AGENT_COMMAND

  const argsOf = () =>
    Array.isArray(config?.agentArgs) && config.agentArgs.length > 0
      ? config.agentArgs.map((value) => String(value))
      : [...DEFAULT_AGENT_ARGS]

  function killGroup(target, signal) {
    if (target === undefined || target.pid === undefined) return
    try {
      process.kill(-target.pid, signal)
    } catch {
      try {
        target.kill(signal)
      } catch {
        // Already gone.
      }
    }
  }

  function waitExit(target, timeoutMs) {
    if (target === undefined || target.exitCode !== null || target.signalCode !== null) return Promise.resolve(true)
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs)
      target.once('exit', () => {
        clearTimeout(timer)
        resolve(true)
      })
    })
  }

  function spawnAgent() {
    const settings = resolveSettings(config)
    let port = '3210'
    try {
      port = new URL(settings.agentUrl).port || '3210'
    } catch {
      port = '3210'
    }
    status.phase = 'starting'
    status.error = undefined
    status.startedAt = Date.now()
    stopping = false
    const command = commandOf()
    const args = argsOf()
    pushLog(`[start] ${command} ${args.join(' ')} (port ${port})`)
    let spawned
    try {
      spawned = spawn(command, args, {
        env: childEnvironment({ CANVAS_AGENT_PORT: port }),
        cwd: dshHome(),
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      status.phase = 'error'
      status.error = `无法启动 ${command}：${error instanceof Error ? error.message : String(error)}`
      pushLog(`[start] ${status.error}`)
      return false
    }
    child = spawned
    status.pid = spawned.pid
    status.managed = true
    spawned.stdout?.on('data', (data) => pushLog(data))
    spawned.stderr?.on('data', (data) => pushLog(data))
    spawned.on('error', (error) => {
      status.phase = 'error'
      status.error = `无法启动 ${command}：${error.message}`
      status.managed = false
      status.pid = undefined
      child = undefined
      pushLog(`[error] ${error.message}`)
    })
    spawned.on('exit', (code, signal) => {
      const unexpected = !stopping
      if (child === spawned) {
        child = undefined
        status.pid = undefined
        status.managed = false
      }
      if (!unexpected) return
      status.phase = 'exited'
      status.error = `本地 Agent 已退出（${signal ?? `code ${code}`}）`
      pushLog(`[exit] ${status.error}`)
    })
    return true
  }

  async function waitReady(agentUrl, timeoutMs) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (disposed) return false
      if (status.phase === 'error' || status.phase === 'exited') return false
      if (await serviceReachable(agentUrl)) return true
      await delay(400)
    }
    return false
  }

  async function start() {
    if (disposed) return state()
    userStopped = false
    if (status.phase === 'starting' || status.phase === 'running') return state()
    const settings = resolveSettings(config)
    if (await serviceReachable(settings.agentUrl)) {
      status.phase = 'external'
      status.managed = false
      status.pid = undefined
      status.error = undefined
      return state()
    }
    if (!spawnAgent()) return state()
    const ready = await waitReady(settings.agentUrl, AGENT_READY_TIMEOUT_MS)
    if (disposed) return state()
    if (ready) {
      status.phase = 'running'
      status.error = undefined
      status.restarts = 0
      pushLog('[ready] agent is listening')
    } else if (status.phase === 'starting') {
      status.error = '本地 Agent 在限定时间内没有就绪'
      pushLog(`[error] ${status.error}`)
      await stop('timeout')
      status.phase = 'error'
    }
    return state()
  }

  async function stop(reason = 'manual') {
    userStopped = reason === 'manual' || reason === 'user'
    const target = child
    if (target === undefined) {
      if (status.phase !== 'external' && status.phase !== 'error') status.phase = 'stopped'
      status.managed = false
      status.pid = undefined
      return state()
    }
    stopping = true
    status.phase = 'stopping'
    pushLog(`[stop] ${reason}`)
    killGroup(target, 'SIGTERM')
    let exited = await waitExit(target, 5000)
    if (!exited) {
      killGroup(target, 'SIGKILL')
      exited = await waitExit(target, 3000)
    }
    child = undefined
    status.pid = undefined
    status.managed = false
    status.phase = 'stopped'
    if (!exited) status.error = '本地 Agent 未在超时内退出，可能仍需手动结束'
    return state()
  }

  function startWatchdog() {
    if (watchdog !== undefined) return
    watchdog = setInterval(() => {
      if (disposed) return
      if (!resolveSettings(config).autoStart) return
      if (userStopped) return
      if (status.phase === 'starting' || status.phase === 'running') return
      if (status.phase === 'external') {
        // Someone else may have stopped theirs; only adopt when it is gone.
        void serviceReachable(resolveSettings(config).agentUrl).then((up) => {
          if (!up && !disposed && status.phase === 'external') void start()
        })
        return
      }
      if (status.restarts >= MAX_AUTO_RESTARTS) return
      status.restarts += 1
      void start()
    }, WATCHDOG_INTERVAL_MS)
    watchdog.unref?.()
  }

  return {
    state,
    start,
    stop,
    startWatchdog,
    async dispose() {
      disposed = true
      if (watchdog !== undefined) {
        clearInterval(watchdog)
        watchdog = undefined
      }
      await stop('dispose').catch(() => undefined)
    },
  }
}

function sendJson(res, status, value) {
  const body = `${JSON.stringify(value)}\n`
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
    'x-content-type-options': 'nosniff',
  })
  res.end(body)
}

async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error('request body too large')
    chunks.push(chunk)
  }
  if (size === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  const parsed = JSON.parse(text)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('request body must be an object')
  return parsed
}

/**
 * Accept the page's own origin, a matching Host header, or a non-browser
 * caller. A different Web origin is rejected so no other site can read the
 * canvas token or drive the local agent through this process.
 */
function sameOriginRequest(req, webServer) {
  const origin = req.headers.origin
  if (typeof origin !== 'string' || origin === '') return true
  let advertised = ''
  try {
    advertised = webServer.getOrigin()
  } catch {
    advertised = ''
  }
  if (advertised !== '' && origin === advertised) return true
  const host = req.headers.host
  if (typeof host !== 'string' || host === '') return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

export function apply(ctx, config) {
  const supervisor = createAgentSupervisor(config)
  const backend = createCanvasOperations((request) => canvasApi(config, request))
  ctx.effect(() => () => void supervisor.dispose(), 'dsh-infinite-canvas: web agent supervisor')
  ctx.effect(() => {
    supervisor.startWatchdog()
    if (!resolveSettings(config).autoStart) return () => {}
    const timer = setTimeout(() => void supervisor.start(), 1500)
    return () => clearTimeout(timer)
  }, 'dsh-infinite-canvas: optional web agent autostart')

  const connection = async () => {
    try {
      const projects = await canvasApi(config, { method: 'GET', path: '/canvas/projects' })
      return { connected: true, projectCount: projects.length }
    } catch (error) { return { connected: false, error: error.message } }
  }
  ctx.inject(['webServer'], (webCtx) => {
    const server = webCtx.webServer
    const handler = async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const path = url.pathname.replace(/\/+$/, '')
      const method = req.method?.toUpperCase() ?? 'GET'
      try {
        if (!sameOriginRequest(req, server)) return sendJson(res, 403, { error: 'cross-origin request rejected' })
        if (path === `${ROUTE_PREFIX}/state` && method === 'GET') return sendJson(res, 200, snapshot(config))
        if (path === `${ROUTE_PREFIX}/connection` && method === 'GET') return sendJson(res, 200, await connection())
        if (path === `${ROUTE_PREFIX}/agent` && method === 'GET') return sendJson(res, 200, { ...await probeAgent(resolveSettings(config).agentUrl), ...supervisor.state() })
        if (path === `${ROUTE_PREFIX}/agent/start` && method === 'POST') {
          await Promise.race([supervisor.start(), delay(700)])
          return sendJson(res, 200, { ...await probeAgent(resolveSettings(config).agentUrl), ...supervisor.state() })
        }
        if (path === `${ROUTE_PREFIX}/agent/stop` && method === 'POST') {
          await supervisor.stop('manual')
          return sendJson(res, 200, { running: false, connected: false, tools: [], ...supervisor.state() })
        }
        if (path === `${ROUTE_PREFIX}/link` && method === 'POST') {
          const body = await readJsonBody(req)
          const canvasId = normalizeCanvasId(body.canvasId ?? '')
          if (canvasId === undefined) throw new Error('画布 ID 无效')
          const settings = resolveSettings(config)
          // Viewing is plain navigation. Only an explicit web-Agent action adds its handshake.
          const link = body.webAgent === true ? connectLinkOf(settings, resolveToken(config).token, canvasId) : { url: canvasPageUrl(settings, canvasId), embedded: false }
          return sendJson(res, 200, link)
        }
        if (path === `${ROUTE_PREFIX}/canvas-key` && method === 'POST') {
          const body = await readJsonBody(req)
          if (typeof body.key !== 'string') throw new Error('key 必须是字符串')
          const key = normalizeApiKey(body.key)
          const baseUrl = body.canvasBaseUrl === undefined ? resolveSettings(config).canvasBaseUrl : normalizeBaseUrl(body.canvasBaseUrl)
          if (!baseUrl) throw new Error('画布站地址无效')
          if (key) await canvasApi(config, { method: 'GET', path: '/canvas/projects', key, baseUrl })
          writeJsonFile(canvasApiFile(config), { key, baseUrl, savedAt: new Date().toISOString() })
          if (key && body.canvasBaseUrl !== undefined) {
            const { path: file, usable } = settingsFromFile(config)
            writeJsonFile(file, { ...usable, version: SETTINGS_VERSION, canvasBaseUrl: baseUrl })
          }
          return sendJson(res, 200, snapshot(config))
        }
        if (path === `${ROUTE_PREFIX}/projects` && method === 'GET') {
          const projects = await canvasApi(config, { method: 'GET', path: '/canvas/projects' })
          return sendJson(res, 200, { projects: projects.map(summarizeProject).filter(Boolean) })
        }
        if (path === `${ROUTE_PREFIX}/projects` && method === 'POST') {
          const body = await readJsonBody(req)
          const project = newCanvasProject(body.title?.trim().slice(0, 80) || NEW_CANVAS_TITLE)
          const saved = await canvasApi(config, { method: 'POST', path: '/canvas/projects', body: { data: project } })
          return sendJson(res, 200, { project: backend.summary(saved), canvasUrl: canvasPageUrl(resolveSettings(config), saved.id) })
        }
        if (path === `${ROUTE_PREFIX}/settings` && method === 'POST') {
          const body = await readJsonBody(req)
          const previous = resolveSettings(config)
          const { path: file, usable } = settingsFromFile(config)
          const next = { version: SETTINGS_VERSION, canvasBaseUrl: usable?.canvasBaseUrl, agentUrl: usable?.agentUrl, autoStart: usable?.autoStart, embedCredentials: usable?.embedCredentials }
          for (const field of ['canvasBaseUrl', 'agentUrl']) if (body[field] !== undefined) {
            next[field] = normalizeBaseUrl(body[field])
            if (!next[field]) throw new Error(`${field} 不是有效的 http(s) 地址`)
          }
          for (const field of ['autoStart', 'embedCredentials']) if (body[field] !== undefined) next[field] = body[field] !== false
          writeJsonFile(file, next)
          if (body.agentUrl !== undefined && previous.agentUrl !== next.agentUrl) {
            await supervisor.stop('configuration')
            if (resolveSettings(config).autoStart) void supervisor.start()
          } else if (body.autoStart === true) void supervisor.start()
          return sendJson(res, 200, snapshot(config))
        }
        return sendJson(res, 404, { error: `unknown route ${method} ${path}` })
      } catch (error) { return sendJson(res, 400, { error: error.message }) }
    }
    webCtx.effect(() => server.register({ kind: 'prefix', path: ROUTE_PREFIX, handler }), 'dsh-infinite-canvas: routes')
  })
  ctx.inject(['skills'], (skillCtx) => {
    skillCtx.effect(() => skillCtx.skills.register({
      name: 'infinite-canvas',
      description: 'Operate saved Infinite Canvas projects, nodes, connections, layout and backend media tasks directly with API Key. No browser or local Agent required. The optional launcher is only for the web app’s local Agent.',
      source: 'runtime',
      content: readFileSync(new URL('./skills/infinite-canvas/SKILL.md', import.meta.url), 'utf8').replace(/^---[\s\S]*?---\s*/, ''),
    }), 'dsh-infinite-canvas: operation skill')
  })
  ctx.inject(['tools'], (toolCtx) => {
    const register = (name, description, properties, required, execute) => toolCtx.effect(() => toolCtx.tools.register({
      name, description,
      parameters: { type: 'object', properties, required, additionalProperties: false },
      output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
      execute: async (args) => { try { return JSON.parse(JSON.stringify(await execute(args))) } catch (error) { return { ok: false, error: error.message } } },
      presentCall: () => ({ card: 'generic', title: name.replaceAll('_', ' ') }),
    }), `dsh-infinite-canvas: ${name}`)
    const string = { type: 'string' }, strings = { type: 'array', items: string }
    register('infinite_canvas_status', 'Check backend API connectivity separately from the optional web-Agent launcher. Backend tools work while the browser is closed and the local Agent is stopped.', {}, [], async () => ({
      ok: true, backend: await connection(), canvasBaseUrl: resolveSettings(config).canvasBaseUrl, apiKeyConfigured: snapshot(config).apiKeyAvailable,
      webAgent: { optional: true, ...supervisor.state(), url: resolveSettings(config).agentUrl },
      hint: 'Use explicit canvasId and revision from backend reads. Do not open a browser or start an Agent to fix API errors.',
    }))
    register('infinite_canvas_projects', 'List, create, rename or delete saved backend canvases. No browser navigation. Read the infinite-canvas skill. open only returns an optional viewing URL. Deleting a canvas needs delete scope and explicit user intent.', {
      action: { type: 'string', enum: ['list', 'create', 'rename', 'delete', 'open'] }, canvasId: string, title: string, expectedRevision: string,
    }, ['action'], async (args) => {
      if (args.action === 'rename') return backend.rename(args)
      if (args.action === 'list') {
        const projects = await canvasApi(config, { method: 'GET', path: '/canvas/projects' })
        return { ok: true, projects: projects.map((p) => ({ ...backend.summary(p), canvasUrl: canvasPageUrl(resolveSettings(config), p.id) })) }
      }
      if (args.action === 'create') {
        const p = newCanvasProject(args.title?.trim().slice(0, 80) || NEW_CANVAS_TITLE)
        const saved = await canvasApi(config, { method: 'POST', path: '/canvas/projects', body: { data: p } })
        const verified = await backend.read(p.id)
        if (revisionOf(saved) !== revisionOf(verified)) throw new Error('新建后的回读不一致，请先读取核对，不要重复创建')
        return { ok: true, created: { ...backend.summary(verified), canvasUrl: canvasPageUrl(resolveSettings(config), p.id) } }
      }
      const p = await backend.read(args.canvasId)
      if (args.action === 'open') return { ok: true, canvasUrl: canvasPageUrl(resolveSettings(config), p.id), browserRequired: false }
      if (args.action === 'delete') return backend.remove(args)
      throw new Error('不支持的画布操作')
    })
    register('infinite_canvas_nodes', 'Read and edit saved canvas nodes, connections, groups and layout via backend API. All writes require expectedRevision from a fresh read. There is no browser selection or implicit current canvas. Delete removes graph references but retains media files and backend tasks. Concurrent browser edits are not atomically protected by the current server.', {
      action: { type: 'string', enum: ['summary', 'query', 'get', 'upstream', 'downstream', 'connected', 'create_text', 'create_primary_script', 'create_media', 'update_text', 'rename', 'move', 'delete', 'connect', 'disconnect', 'group', 'arrange'] },
      canvasId: string, expectedRevision: string, nodeId: string, nodeIds: strings, sourceNodeIds: strings, title: string, projectTitle: string, content: string, prompt: string, keyword: string,
      kind: { type: 'string', enum: ['text', 'image', 'video', 'audio', 'config', 'panorama', 'director', 'group'] },
      fromNodeId: string, toNodeId: string, connectionId: string, x: { type: 'number' }, y: { type: 'number' }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100 },
    }, ['action', 'canvasId'], backend.nodes)
    register('infinite_canvas_catalog', 'Read backend public model/channel options, saved workflows, personal/system skills or a system skill file. User model/storage credentials and local browser configuration are deliberately unavailable.', {
      resource: { type: 'string', enum: ['models', 'workflows', 'skills', 'system_skills', 'skill_file'] }, skillId: string, path: string,
    }, ['resource'], backend.catalog)
    register('infinite_canvas_media', 'Explicit backend media task submission, read-only status, sync result into a prepared media node, or stop task. Submit only on user-authorized generation; request must use the backend provider JSON contract with explicit model and channelId, never provider credentials. Create a media node first. submit and sync need expectedRevision. Do not retry uncertain submissions or reuse a submitted node. Does not reproduce browser-local providers or workflows automatically.', {
      action: { type: 'string', enum: ['submit', 'status', 'sync', 'stop'] }, canvasId: string, nodeId: string, expectedRevision: string,
      channelId: string, edit: { type: 'boolean' }, request: { type: 'object', additionalProperties: true },
    }, ['action', 'canvasId', 'nodeId'], backend.media)
  })
}
