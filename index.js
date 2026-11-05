/**
 * Host half of the Infinite Canvas bundle.
 *
 * Owns four things and nothing else:
 *  1. The canvas settings a person edits in the Harness UI (a small JSON file
 *     under DSH_HOME, so a save takes effect without reloading the plugin).
 *  2. A supervisor for the local `canvas-agent` service: it starts the official
 *     `npx -y @tigerowo/canvas-agent` child, waits for it to listen, restarts it
 *     after a crash, and stops it when the plugin unloads.
 *  3. Same-origin HTTP routes the Web panel and the Settings page call.
 *  4. Model-facing status/project tools and a bundled operation skill.
 *
 * The canvas itself is a third-party Web application and is never embedded:
 * a cross-site iframe cannot carry that site's login session, so the embedded
 * canvas would never start and never reach the local agent. The panel therefore
 * only *opens* the canvas in a real browser tab, with the agent URL and token in
 * the address hash — the same handshake `canvas-agent open` performs. The token
 * is returned only to the configured canvas: `POST /token` and `POST /link` answer a same-origin
 * request only.
 *
 * No canvas id has to be pinned: an empty id opens the deployment's canvas list,
 * and whichever canvas the person opens registers itself with the agent, so the
 * canvas id becomes the agent's context rather than a stored setting.
 *
 * @module dsh-infinite-canvas
 */
import { randomBytes } from 'node:crypto'
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

/** MCP server namespace declared by this bundle's patch row. */
const MCP_SERVER_NAME = 'infinite-canvas'

/** Settings file shape version; a different version is ignored rather than guessed at. */
const SETTINGS_VERSION = 1

/** Default title of a canvas created through Host, matching the Web app. */
const NEW_CANVAS_TITLE = '未命名画布'
/** Canvas deployment REST API. */
const CANVAS_API_PREFIX = '/api/v1'
const CANVAS_API_TIMEOUT_MS = 12_000

const PROBE_TIMEOUT_MS = 2500
const TOOLS_TIMEOUT_MS = 4000
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
  const target = new URL(`${baseUrl}${CANVAS_API_PREFIX}${request.path}`)
  if (target.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)) {
    throw new Error('API Key 需要 HTTPS 站点地址（本机测试除外）')
  }
  const headers = { authorization: `Bearer ${key}` }
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
  if (response.status === 403) throw new Error('API Key 权限不足或请求额度耗尽；读取需 read，新建需 read + write')
  if (response.status === 429) throw new Error(`API Key 请求过于频繁，请在 ${response.headers.get('retry-after') ?? '60'} 秒后重试`)
  let envelope
  try {
    envelope = await response.json()
  } catch {
    throw new Error(`画布站返回异常（HTTP ${response.status}）`)
  }
  if (!response.ok || envelope?.code !== 0) {
    const message = typeof envelope?.msg === 'string' ? envelope.msg.replaceAll(key, '<key>') : ''
    throw new Error(message || `画布站请求失败（HTTP ${response.status}）`)
  }
  return envelope.data
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
    tokenSource: token.source,
    tokenFile: token.file,
    apiKeyAvailable: apiKey.key !== '',
    apiKeySource: apiKey.source,
    apiKeyFile: apiKey.file,
    apiKeyRevision: readJsonFile(apiKey.file)?.savedAt ?? '',
    settingsPath: settings.path,
    settingsStored: settings.stored !== undefined,
    clientId: typeof config?.clientId === 'string' ? config.clientId : '',
    mcpServerName: MCP_SERVER_NAME,
    defaults: { canvasBaseUrl: DEFAULT_CANVAS_BASE_URL, agentUrl: DEFAULT_AGENT_URL },
  }
}

/**
 * Ask the local agent what it knows. `GET /config` needs no credentials, so a
 * missing token still reports whether the service is up.
 */
async function probeAgent(agentUrl, token) {
  const base = String(agentUrl).replace(/\/+$/, '')
  try {
    const configResponse = await fetch(`${base}/config`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
    const configBody = await configResponse.json().catch(() => undefined)
    if (!configResponse.ok) {
      return { running: false, connected: false, tools: [], error: `本地 Agent 返回 HTTP ${configResponse.status}` }
    }
    const reported = {
      running: true,
      hasToken: configBody?.hasToken === true,
      connected: false,
      tools: [],
      error: undefined,
    }
    if (token === '') return { ...reported, error: '未找到连接 Token，请先启动本地 Canvas Agent' }
    const response = await fetch(`${base}/tools?clientId=`, {
      headers: { 'x-canvas-agent-token': token },
      signal: AbortSignal.timeout(TOOLS_TIMEOUT_MS),
    })
    const body = await response.json().catch(() => undefined)
    if (!response.ok) {
      return { ...reported, error: typeof body?.error === 'string' ? body.error : `HTTP ${response.status}` }
    }
    const tools = Array.isArray(body) ? body : []
    return {
      ...reported,
      connected: true,
      tools: tools.map((tool) => tool?.name).filter((toolName) => typeof toolName === 'string' && !['set_agent_state', 'read_skill_file'].includes(toolName)),
      error: undefined,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { running: false, connected: false, tools: [], error: message }
  }
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
  /**
   * A canvas the panel should bring the browser tab to. Kept in memory only:
   * nothing about "which canvas" is ever written to settings. The panel polls
   * /state and navigates its single named tab, which is how a canvas created
   * here reaches the person without opening a second tab.
   */
  let pending = null
  /** Origin of the Harness page, so chat links can redirect instead of leaking a token. */
  let pageOrigin = ''

  ctx.effect(() => () => void supervisor.dispose(), 'dsh-infinite-canvas: agent supervisor')

  ctx.effect(
    () => {
      supervisor.startWatchdog()
      if (!resolveSettings(config).autoStart) return () => undefined
      const timer = setTimeout(() => {
        void supervisor.start()
      }, 1500)
      return () => clearTimeout(timer)
    },
    'dsh-infinite-canvas: agent autostart',
  )

  ctx.inject(['webServer'], (webCtx) => {
    const webServer = webCtx.webServer
    try {
      pageOrigin = webServer.getOrigin()
    } catch {
      pageOrigin = ''
    }

    const agentView = async () => {
      const settings = resolveSettings(config)
      const token = resolveToken(config)
      const probe = await probeAgent(settings.agentUrl, token.token)
      const supervision = supervisor.state()
      return { ...probe, ...supervision, error: supervision.error ?? probe.error, probeError: probe.error }
    }

    const handler = async (req, res) => {
      const requestUrl = new URL(typeof req.url === 'string' ? req.url : '/', 'http://localhost')
      const path = requestUrl.pathname.replace(/\/+$/, '') || '/'
      const method = typeof req.method === 'string' ? req.method.toUpperCase() : 'GET'

      try {
        if (path === `${ROUTE_PREFIX}/state` && method === 'GET') {
          return sendJson(res, 200, { ...snapshot(config), pending })
        }

        if (path === `${ROUTE_PREFIX}/target` && method === 'POST') {
          if (!sameOriginRequest(req, webServer)) return sendJson(res, 403, { error: 'cross-origin request rejected' })
          const body = await readJsonBody(req)
          const canvasId = body.canvasId === undefined ? '' : normalizeCanvasId(body.canvasId)
          if (canvasId === undefined) return sendJson(res, 400, { error: '画布 ID 无效' })
          if (canvasId === '') {
            pending = null
            return sendJson(res, 200, { pending })
          }
          pending = {
            canvasId,
            title: typeof body.title === 'string' ? body.title : '',
            blocked: body.blocked === true,
            at: Date.now(),
          }
          return sendJson(res, 200, { pending })
        }

        if (path === `${ROUTE_PREFIX}/agent` && method === 'GET') {
          return sendJson(res, 200, await agentView())
        }

        if (path === `${ROUTE_PREFIX}/agent/start` && method === 'POST') {
          if (!sameOriginRequest(req, webServer)) return sendJson(res, 403, { error: 'cross-origin request rejected' })
          await Promise.race([supervisor.start(), delay(700)])
          return sendJson(res, 200, await agentView())
        }

        if (path === `${ROUTE_PREFIX}/agent/stop` && method === 'POST') {
          if (!sameOriginRequest(req, webServer)) return sendJson(res, 403, { error: 'cross-origin request rejected' })
          await supervisor.stop('manual')
          return sendJson(res, 200, await agentView())
        }

        if (path === `${ROUTE_PREFIX}/token` && method === 'POST') {
          if (!sameOriginRequest(req, webServer)) return sendJson(res, 403, { error: 'cross-origin request rejected' })
          const token = resolveToken(config)
          if (token.token === '') return sendJson(res, 404, { error: 'no connect token available' })
          const settings = resolveSettings(config)
          return sendJson(res, 200, { token: token.token, agentUrl: settings.agentUrl, source: token.source })
        }

        if (path === `${ROUTE_PREFIX}/link` && method === 'POST') {
          if (!sameOriginRequest(req, webServer)) return sendJson(res, 403, { error: 'cross-origin request rejected' })
          const body = await readJsonBody(req).catch(() => ({}))
          const requested = body.canvasId === undefined ? '' : normalizeCanvasId(body.canvasId)
          if (requested === undefined) return sendJson(res, 400, { error: '画布 ID 无效' })
          const settings = resolveSettings(config)
          const token = resolveToken(config)
          const link = connectLinkOf(settings, token.token, requested)
          return sendJson(res, 200, {
            url: link.url,
            embedded: link.embedded,
            canvasUrl: canvasPageUrl(settings, requested),
            canvasId: requested,
            agentUrl: settings.agentUrl,
          })
        }

        if (path === `${ROUTE_PREFIX}/canvas-key` && method === 'POST') {
          if (!sameOriginRequest(req, webServer)) return sendJson(res, 403, { error: 'cross-origin request rejected' })
          const body = await readJsonBody(req)
          if (typeof body.key !== 'string') return sendJson(res, 400, { error: 'key 必须是字符串' })
          const key = normalizeApiKey(body.key)
          const baseUrl = body.canvasBaseUrl === undefined ? resolveSettings(config).canvasBaseUrl : normalizeBaseUrl(body.canvasBaseUrl)
          if (baseUrl === undefined) return sendJson(res, 400, { error: '画布站地址无效' })
          if (key !== '') await canvasApi(config, { method: 'GET', path: '/canvas/projects', key, baseUrl })
          writeJsonFile(canvasApiFile(config), { key, baseUrl, savedAt: new Date().toISOString() })
          if (key !== '' && body.canvasBaseUrl !== undefined) {
            const { path: file, usable } = settingsFromFile(config)
            writeJsonFile(file, { ...usable, version: SETTINGS_VERSION, canvasBaseUrl: baseUrl })
          }
          return sendJson(res, 200, snapshot(config))
        }

        if (path === `${ROUTE_PREFIX}/open` && method === 'GET') {
          const requested = normalizeCanvasId(requestUrl.searchParams.get('canvas') ?? '')
          if (requested === undefined) return sendJson(res, 400, { error: '画布 ID 无效' })
          const settings = resolveSettings(config)
          const token = resolveToken(config)
          const target = connectLinkOf(settings, token.token, requested).url
          if (pending?.canvasId === requested) pending = null
          res.writeHead(302, { location: target, 'cache-control': 'no-store' })
          return res.end()
        }

        if (path === `${ROUTE_PREFIX}/projects` && method === 'GET') {
          if (!sameOriginRequest(req, webServer)) return sendJson(res, 403, { error: 'cross-origin request rejected' })
          const raw = await canvasApi(config, { method: 'GET', path: '/canvas/projects' })
          const list = Array.isArray(raw) ? raw : []
          const projects = list.map(summarizeProject).filter((item) => item !== undefined)
          return sendJson(res, 200, { projects })
        }

        if (path === `${ROUTE_PREFIX}/projects` && method === 'POST') {
          if (!sameOriginRequest(req, webServer)) return sendJson(res, 403, { error: 'cross-origin request rejected' })
          const body = await readJsonBody(req)
          const title =
            typeof body.title === 'string' && body.title.trim() !== '' ? body.title.trim().slice(0, 80) : NEW_CANVAS_TITLE
          const project = newCanvasProject(title)
          await canvasApi(config, { method: 'POST', path: '/canvas/projects', body: { data: project } })
          const settings = resolveSettings(config)
          pending = { canvasId: project.id, title: project.title, at: Date.now() }
          return sendJson(res, 200, {
            project: summarizeProject(project),
            canvasUrl: canvasPageUrl(settings, project.id),
            pending,
          })
        }

        if (path === `${ROUTE_PREFIX}/settings` && method === 'POST') {
          if (!sameOriginRequest(req, webServer)) return sendJson(res, 403, { error: 'cross-origin request rejected' })
          const body = await readJsonBody(req)
          const { path: file, stored } = settingsFromFile(config)
          const next = {
            version: SETTINGS_VERSION,
            canvasBaseUrl: undefined,
            agentUrl: undefined,
            embedCredentials: undefined,
            autoStart: undefined,
          }
          for (const key of ['canvasBaseUrl', 'agentUrl', 'embedCredentials', 'autoStart']) {
            if (stored?.[key] !== undefined) next[key] = stored[key]
          }
          if (body.canvasBaseUrl !== undefined) {
            const normalized = normalizeBaseUrl(body.canvasBaseUrl)
            if (normalized === undefined) return sendJson(res, 400, { error: 'canvasBaseUrl 不是有效的 http(s) 地址' })
            next.canvasBaseUrl = normalized
          }
          if (body.agentUrl !== undefined) {
            const normalized = normalizeBaseUrl(body.agentUrl)
            if (normalized === undefined) return sendJson(res, 400, { error: 'agentUrl 不是有效的 http(s) 地址' })
            next.agentUrl = normalized
          }
          if (body.embedCredentials !== undefined) next.embedCredentials = body.embedCredentials !== false
          if (body.autoStart !== undefined) next.autoStart = body.autoStart !== false
          for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key]
          const previous = resolveSettings(config)
          writeJsonFile(file, next)
          if (body.agentUrl !== undefined && previous.agentUrl !== next.agentUrl) {
            await supervisor.stop('configuration')
            if (resolveSettings(config).autoStart) void supervisor.start()
          } else if (body.autoStart === true) void supervisor.start()
          return sendJson(res, 200, snapshot(config))
        }

        return sendJson(res, 404, { error: `unknown route ${method} ${path}` })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return sendJson(res, 400, { error: message })
      }
    }

    webCtx.effect(
      () => webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler }),
      'dsh-infinite-canvas: routes',
    )
  })

  ctx.inject(['skills'], (skillCtx) => {
    skillCtx.effect(() => skillCtx.skills.register({
      name: 'infinite-canvas',
      description: 'Use Infinite Canvas in Harness: list, create or select a canvas with the configured API Key, then edit its live nodes using the canvas MCP tools. Handles connection and browser handoff.',
      source: 'runtime',
      content: readFileSync(new URL('./skills/infinite-canvas/SKILL.md', import.meta.url), 'utf8').replace(/^---[\s\S]*?---\s*/, ''),
    }), 'dsh-infinite-canvas: operation skill')
  })

  ctx.inject(['tools'], (toolCtx) => {
    toolCtx.effect(
      () =>
        toolCtx.tools.register({
          name: 'infinite_canvas_status',
          description:
            'Report the Infinite Canvas setup for this Harness: the canvas URL, whether the local canvas-agent service is running or can be started, whether a canvas tab is currently connected, which canvas tools it exposes as mcp__infinite-canvas__<tool>, and whether a canvas the Host asked for is still waiting for the browser (pendingBlocked + openLink). Use it before driving the canvas, after creating a canvas, and to explain what to fix when those MCP tools are missing.',
          parameters: { type: 'object', properties: {}, additionalProperties: false },
          output: {
            schema: {
              type: 'object',
              properties: {
                canvasUrl: {
                  type: 'string',
                  description: 'The deployment canvas list the panel opens; no canvas id is stored anywhere.',
                },
                canvasListUrl: { type: 'string', description: 'Same value as canvasUrl, named for what it is.' },
                canvasBaseUrl: { type: 'string', description: 'Canvas deployment base URL.' },
                agentUrl: { type: 'string', description: 'Local canvas-agent service URL.' },
                agentRunning: { type: 'boolean', description: 'Whether the local canvas-agent service answered.' },
                phase: { type: 'string', description: 'Supervisor phase: idle, starting, running, external, stopping, stopped, exited or error.' },
                autoStart: { type: 'boolean', description: 'Whether the plugin keeps the local agent running for the user.' },
                connected: { type: 'boolean', description: 'Whether a canvas tab is connected to the agent.' },
                tokenAvailable: { type: 'boolean', description: 'Whether a connect token was found on this machine.' },
                canvasApiKeyAvailable: {
                  type: 'boolean',
                  description: 'Whether a dedicated user API Key is configured for infinite_canvas_projects (read to list, read + write to create).',
                },
                pendingCanvasId: {
                  type: 'string',
                  description: 'Canvas id the browser was asked to show, or an empty string when nothing is pending.',
                },
                pendingCanvasTitle: { type: 'string', description: 'Title of that pending canvas, when known.' },
                pendingBlocked: {
                  type: 'boolean',
                  description:
                    'True when the browser refused the automatic tab switch, so the person has to open the link once.',
                },
                openLink: {
                  type: 'string',
                  description:
                    'Same-origin link that redirects to the credentialed canvas page; safe to hand to the user because the token only appears in the redirect target, not in this URL. Empty when the Harness origin is unknown.',
                },
                tools: { type: 'array', items: { type: 'string' }, description: 'Tool names the connected canvas exposes.' },
                mcpServerName: { type: 'string', description: 'MCP server namespace, for mcp__<namespace>__<tool> names.' },
                settingsPath: { type: 'string', description: 'Where the UI settings file lives.' },
                hint: { type: 'string', description: 'What to do next when something is missing.' },
              },
              required: [
                'canvasUrl',
                'canvasListUrl',
                'canvasBaseUrl',
                'agentUrl',
                'agentRunning',
                'phase',
                'autoStart',
                'connected',
                'tokenAvailable',
                'canvasApiKeyAvailable',
                'pendingCanvasId',
                'pendingCanvasTitle',
                'pendingBlocked',
                'openLink',
                'tools',
                'mcpServerName',
                'settingsPath',
                'hint',
              ],
              additionalProperties: false,
            },
            render(_args, value) {
              return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
            },
          },
          async execute() {
            const state = snapshot(config)
            const probe = await probeAgent(state.agentUrl, resolveToken(config).token)
            const supervision = supervisor.state()
            const pendingId = pending === null ? '' : pending.canvasId
            const openLink =
              pageOrigin === ''
                ? ''
                : `${pageOrigin}${ROUTE_PREFIX}/open${pendingId === '' ? '' : `?canvas=${encodeURIComponent(pendingId)}`}`
            const blocked = pending !== null && pending.blocked === true
            const hint = !state.tokenAvailable
              ? '连接凭证尚未生成：本地 Agent 启动后会写入 ~/.infinite-canvas/codex-agent.json；面板上的「启动 Agent」可代劳。'
              : !probe.running
                ? `本地 Canvas Agent 未运行。面板上的「启动 Agent」会自动拉起 npx -y @tigerowo/canvas-agent@latest（默认监听 ${state.agentUrl}）。`
                : !probe.connected
                  ? '本地 Agent 已运行，但还没有画布连接：在「无限画布」面板点「打开画布」，用浏览器打开带凭证的列表页并选一张画布；也可以用 infinite_canvas_projects 的 create 新建，面板会把同一个标签页切过去。'
                  : '画布已连接，先用 get_canvas_summary 核对目标 ID，再调用 mcp__infinite-canvas__* 工具；当前画布 id 用 get_canvas_summary 读取，它由所连接的画布页决定，没有任何设置记录它。'
            const finalHint = blocked
              ? `浏览器拦下了自动打开：把 openLink 原样发给用户，用户点一下就会跳到带凭证的画布页（${openLink}）。`
              : hint
            return {
              canvasUrl: state.canvasUrl,
              canvasListUrl: state.canvasListUrl,
              canvasBaseUrl: state.canvasBaseUrl,
              agentUrl: state.agentUrl,
              agentRunning: probe.running === true,
              phase: supervision.phase,
              autoStart: state.autoStart,
              connected: probe.connected === true,
              tokenAvailable: state.tokenAvailable,
              canvasApiKeyAvailable: state.apiKeyAvailable,
              tools: probe.tools,
              mcpServerName: state.mcpServerName,
              settingsPath: state.settingsPath,
              pendingCanvasId: pendingId,
              pendingCanvasTitle: pending === null ? '' : pending.title,
              pendingBlocked: blocked,
              openLink,
              hint: finalHint,
            }
          },
          presentCall: () => ({ card: 'generic', title: 'Infinite Canvas status', kind: 'read' }),
        }),
      'dsh-infinite-canvas: status tool',
    )

    /**
     * The canvas-agent MCP tool set has no canvas-management tools, so the
     * deployment API is used here: list what exists, or create a canvas when the
     * person asked for a new one. A created canvas is handed to the panel as the
     * pending target, and the panel navigates its single browser tab to it — no
     * second tab, and nothing about the canvas is stored.
     */
    toolCtx.effect(
      () =>
        toolCtx.tools.register({
          name: 'infinite_canvas_projects',
          description:
            'Use the configured user API Key to list (read), create (read + write), or open an existing canvas by id. Never ask for a browser session token. Read the infinite-canvas skill before multi-step editing. The canvas id is never stored: whichever canvas the browser tab shows is the agent context (read it with get_canvas_summary). Create only when the user asked for a new canvas. After creating, call infinite_canvas_status: if pendingBlocked is true (the browser refused the automatic tab switch because no canvas tab was open yet), paste its openLink to the user so one click opens the credentialed canvas page.',
          parameters: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['list', 'create', 'open'], description: 'list canvases, create a new empty one, or open an existing canvas by id.' },
              title: { type: 'string', description: 'Title for a new canvas; defaults to 未命名画布.' },
              canvasId: { type: 'string', description: 'Existing canvas id from list; required for open.' },
            },
            required: ['action'],
            additionalProperties: false,
          },
          output: {
            schema: {
              type: 'object',
              properties: {
                ok: { type: 'boolean', description: 'Whether the deployment API call succeeded.' },
                projects: {
                  type: 'array',
                  description: 'Saved canvases, as the deployment returns them.',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      title: { type: 'string' },
                      updatedAt: { type: 'string' },
                      nodeCount: { type: 'number' },
                    },
                    required: ['id', 'title', 'updatedAt', 'nodeCount'],
                    additionalProperties: false,
                  },
                },
                created: {
                  type: 'object',
                  description: 'The canvas just created, when action was create.',
                  properties: {
                    id: { type: 'string' },
                    title: { type: 'string' },
                    canvasUrl: { type: 'string' },
                  },
                  required: ['id', 'title', 'canvasUrl'],
                  additionalProperties: false,
                },
                error: { type: 'string', description: 'Why the call failed, when ok is false.' },
              },
              required: ['ok', 'projects'],
              additionalProperties: false,
            },
            render(_args, value) {
              return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
            },
          },
          async execute(args) {
            const action = args?.action ?? 'list'
            try {
              if (action === 'create') {
                const rawTitle = args !== null && typeof args === 'object' ? args.title : undefined
                const title = typeof rawTitle === 'string' && rawTitle.trim() !== '' ? rawTitle.trim().slice(0, 80) : NEW_CANVAS_TITLE
                const project = newCanvasProject(title)
                await canvasApi(config, { method: 'POST', path: '/canvas/projects', body: { data: project } })
                const summary = summarizeProject(project)
                pending = { canvasId: summary.id, title: summary.title, at: Date.now() }
                return {
                  ok: true,
                  projects: [],
                  created: {
                    id: summary.id,
                    title: summary.title,
                    canvasUrl: canvasPageUrl(resolveSettings(config), summary.id),
                  },
                }
              }
              const raw = await canvasApi(config, { method: 'GET', path: '/canvas/projects' })
              const projects = (Array.isArray(raw) ? raw : []).map(summarizeProject).filter((item) => item !== undefined)
              if (action === 'open') {
                const project = projects.find((item) => item.id === args.canvasId)
                if (!project) throw new Error('画布不存在，请先列出画布并核对 ID')
                pending = { canvasId: project.id, title: project.title, at: Date.now() }
              } else if (action !== 'list') throw new Error('不支持的画布操作')
              return { ok: true, projects }
            } catch (error) {
              return { ok: false, projects: [], error: error instanceof Error ? error.message : String(error) }
            }
          },
          presentCall: () => ({ card: 'generic', title: 'Infinite Canvas projects', kind: 'read' }),
        }),
      'dsh-infinite-canvas: projects tool',
    )
  })
}
