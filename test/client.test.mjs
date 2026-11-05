/**
 * Harness-free test of the Client half.
 *
 * There is no React and no browser here: a small hook runtime renders the whole
 * component tree of the single registered seat (`settings.section`) against a
 * stubbed `fetch`, then drives the background tab follower that `apply`
 * registers. A missing helper, a throwing component, or a bad effect fails here
 * instead of showing a blank Settings page.
 *
 * Run with: node test/client.test.mjs
 */
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

const checks = []
function check(name, ok, detail) {
  checks.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : ` — ${detail}`}`)
}

const BASE = 'http://127.0.0.1:62692'

/** What each same-origin route answers while the settings page loads. */
const ROUTES = {
  state: {
    canvasBaseUrl: 'https://canvas.example.com',
    canvasUrl: 'https://canvas.example.com/canvas',
    canvasListUrl: 'https://canvas.example.com/canvas',
    agentUrl: 'http://127.0.0.1:3210',
    autoStart: true,
    embedCredentials: true,
    tokenAvailable: true,
    tokenSource: 'agent-file',
    tokenFile: '/tmp/codex-agent.json',
    apiKeyAvailable: true,
    apiKeySource: 'file',
    apiKeyFile: '/tmp/canvas-api.json',
    settingsPath: '/tmp/settings.json',
    mcpServerName: 'infinite-canvas',
    pending: { canvasId: 'fresh-canvas', title: '新画布' },
    defaults: { canvasBaseUrl: 'https://canvas.example.com', agentUrl: 'http://127.0.0.1:3210' },
  },
  agent: {
    running: true,
    connected: true,
    managed: true,
    phase: 'running',
    tools: ['create_text_node', 'get_canvas_summary'],
    log: ['Local URL: http://127.0.0.1:3210', '[ready] agent is listening'],
  },
  link: {
    url: 'https://canvas.example.com/canvas#agentUrl=http%3A%2F%2F127.0.0.1%3A3210&agentToken=abc',
    embedded: true,
    canvasUrl: 'https://canvas.example.com/canvas',
    canvasId: '',
    agentUrl: 'http://127.0.0.1:3210',
  },
  projects: { projects: [{ id: 'p1', title: '画布一', updatedAt: '2026-11-04T10:00:00.000Z', nodeCount: 2 }] },
  target: { pending: null },
  settings: { canvasUrl: 'https://canvas.example.com/canvas' },
  'canvas-key': { apiKeyAvailable: true },
  'agent/start': { running: true, connected: true, phase: 'running' },
  'agent/stop': { running: false, connected: false, phase: 'stopped' },
}

const requests = []
const posts = []
const windowCalls = []
const timers = []

async function fetchStub(url, init) {
  const name = String(url).replace(/^.*\/infinite-canvas\//, '').replace(/\/+$/, '')
  requests.push(name)
  if (init !== undefined && typeof init.body === 'string') {
    try {
      posts.push({ name, body: JSON.parse(init.body) })
    } catch {
      posts.push({ name, body: null })
    }
  }
  const body = ROUTES[name]
  if (body === undefined) return { ok: false, status: 404, json: async () => ({ error: `unknown ${name}` }) }
  return { ok: true, status: 200, json: async () => body }
}

// ---------------------------------------------------------------------------
// A hook runtime small enough to read: component instances are keyed by their
// position in the tree, so state survives a re-render of the whole tree.
// ---------------------------------------------------------------------------
const stores = new Map()
const effects = []
let currentKey = ''
let hookIndex = 0
let dirty = false

const React = {
  createElement: (type, props, ...children) => ({
    type,
    props: { ...props, children: children.flat() },
    children: children.flat(),
  }),
  useState: (initial) => {
    const slot = hookIndex
    hookIndex += 1
    if (!stores.has(currentKey)) stores.set(currentKey, [])
    const store = stores.get(currentKey)
    if (!(slot in store)) store[slot] = typeof initial === 'function' ? initial() : initial
    return [
      store[slot],
      (next) => {
        store[slot] = typeof next === 'function' ? next(store[slot]) : next
        dirty = true
      },
    ]
  },
  useEffect: (fn, deps) => {
    const slot = hookIndex++
    if (!stores.has(currentKey)) stores.set(currentKey, [])
    const store = stores.get(currentKey)
    const previous = store[slot]
    if (!previous || !deps || deps.some((value, index) => !Object.is(value, previous.deps[index]))) {
      effects.push(() => {
        previous?.cleanup?.()
        store[slot] = { deps, cleanup: fn() }
      })
    }
  },
  useCallback: (fn, deps) => {
    const slot = hookIndex++
    if (!stores.has(currentKey)) stores.set(currentKey, [])
    const store = stores.get(currentKey)
    const previous = store[slot]
    if (!previous || deps.some((value, index) => !Object.is(value, previous.deps[index]))) store[slot] = { deps, fn }
    return store[slot].fn
  },
  useRef: (initial) => {
    const slot = hookIndex
    hookIndex += 1
    if (!stores.has(currentKey)) stores.set(currentKey, [])
    const store = stores.get(currentKey)
    if (!(slot in store)) store[slot] = { current: initial }
    return store[slot]
  },
  useId: () => {
    hookIndex += 1
    return `id-${hookIndex}`
  },
}

/** Render an element, invoking function components depth-first. */
function mount(node, key) {
  if (node === null || node === undefined || node === false) return null
  if (Array.isArray(node)) return node.map((child, index) => mount(child, `${key}[${index}]`))
  if (typeof node !== 'object') return { type: '#text', text: String(node), children: [] }
  if (typeof node.type === 'function') {
    currentKey = key
    hookIndex = 0
    const rendered = node.type(node.props)
    return { type: node.type.name || 'component', props: node.props, children: mount(rendered, `${key}.out`) }
  }
  const children = []
  for (const [index, child] of (node.children ?? []).entries()) {
    const mounted = mount(child, `${key}.${index}`)
    if (Array.isArray(mounted)) children.push(...mounted)
    else if (mounted !== null) children.push(mounted)
  }
  return { type: typeof node.type === 'string' ? node.type : 'element', props: node.props, children }
}

function collect(node, out = []) {
  if (node === null || node === undefined) return out
  if (Array.isArray(node)) {
    for (const child of node) collect(child, out)
    return out
  }
  if (typeof node === 'string') {
    out.push(node)
    return out
  }
  if (node.text !== undefined) out.push(node.text)
  if (node.props !== undefined) {
    for (const value of Object.values(node.props)) {
      if (typeof value === 'string' && value.startsWith('https://')) out.push(value)
    }
  }
  const children = node.children
  if (Array.isArray(children)) for (const child of children) collect(child, out)
  else if (children !== undefined && children !== null) collect(children, out)
  return out
}

const settle = async () => {
  for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setImmediate(resolve))
}

// ---------------------------------------------------------------------------
let spec
const sandbox = {
  window: {
    __ModuleLoader__: { load: (next) => (spec = next) },
    open: (url, name) => {
      windowCalls.push({ url, name })
      return { opener: 'set' }
    },
  },
  document: { baseURI: `${BASE}/` },
  fetch: fetchStub,
  setTimeout: (fn, ms) => {
    timers.push({ fn, ms })
    return timers.length
  },
  clearTimeout: () => {},
  console,
  URL,
  URLSearchParams,
}
vm.createContext(sandbox)
vm.runInContext(source, sandbox, { filename: 'client.js' })

const module = spec.factory((name) => {
  if (name === 'react') return React
  throw new Error(`unexpected require(${name})`)
})

const t = (key, vars) =>
  vars === undefined || vars === null
    ? key
    : `${key}(${Object.entries(vars)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(',')})`

// ---------------------------------------------------------------------------
// 1. The plugin registers one seat and one background effect.
// ---------------------------------------------------------------------------
let seat
const disposers = []
module.apply({
  effect: (factory) => {
    const dispose = factory()
    if (typeof dispose === 'function') disposers.push(dispose)
    return dispose
  },
  locale: { register: () => {}, bind: () => t },
  slots: {
    inject: (_name, register) => register(),
    register: (definition, component) => {
      seat = { definition, component }
      return () => {}
    },
  },
})

check('only the settings seat is registered', seat !== undefined && seat.definition.name === 'settings.section', seat?.definition.name)

// ---------------------------------------------------------------------------
// 2. The settings page renders, and its effects reach the Host API.
// ---------------------------------------------------------------------------
let tree = null
let renderError
for (let round = 0; round < 6; round += 1) {
  effects.length = 0
  dirty = false
  try {
    tree = mount({ type: seat.component, props: { t }, children: [] }, 'root')
  } catch (error) {
    renderError = error
    break
  }
  for (const effect of effects) {
    try {
      effect()
    } catch (error) {
      renderError = error
    }
  }
  await settle()
  if (!dirty) break
}

check('the settings page renders', renderError === undefined, renderError === undefined ? undefined : String(renderError))
check('it reads state from the Host', requests.includes('state'))
check('it reads the connect link', requests.includes('link'))
check('it reads the agent probe', requests.includes('agent'))
check('it lists the account canvases', requests.includes('projects'))

const text = collect(tree).join(' | ')
if (process.env.DEBUG_TREE === '1') console.log('TREE:', text.slice(-2200))

check('the title and intro render', text.includes('settings.title') && text.includes('settings.intro'))
check('the settings form renders', text.includes('form.baseUrl') && text.includes('form.save'))
check('API Key form replaces session-token instructions', text.includes('form.key') && text.includes('form.keyHint') && !source.includes('localStorage') && !source.includes('TOKEN_SNIPPET'))
check('connection facts render', text.includes('status.heading') && text.includes('status.tools'))
check('the start/stop control renders', text.includes('action.stopAgent') || text.includes('action.startAgent'))
check('the canvas list renders', text.includes('projects.title') && text.includes('画布一') && text.includes('projects.open') && text.includes('canvas.example.com'))
check('a pending canvas is announced', text.includes('panel.pending(title=新画布)'))
check('the pending canvas gets its own credentialed link', text.includes('https://canvas.example.com/canvas/fresh-canvas#agentUrl='))

// ---------------------------------------------------------------------------
// 3. The background follower navigates the single canvas tab by name.
// ---------------------------------------------------------------------------
/** The follower's first poll uses a 2.5s delay; later polls are the newest timer. */
const takeFollowerTick = () => {
  const index = timers.findIndex((timer) => timer.ms === 2500)
  if (index !== -1) return timers.splice(index, 1)[0].fn
  return timers.pop()?.fn
}

const tick = takeFollowerTick()
check('the tab follower scheduled a first poll', typeof tick === 'function')
if (typeof tick === 'function') {
  await tick()
  await settle()
}
check('the follower opens the pending canvas', windowCalls.length === 1, JSON.stringify(windowCalls))
check('it reuses the named canvas tab', windowCalls[0]?.name === 'dsh-infinite-canvas', windowCalls[0]?.name)
check('it opens the credentialed link', String(windowCalls[0]?.url).includes('#agentUrl='), String(windowCalls[0]?.url).slice(0, 60))
check('it clears the pending target afterwards', posts.some((post) => post.name === 'target' && post.body.canvasId === ''))

// A browser that refuses the switch must report it, so the model can hand over a link.
sandbox.window.open = () => null
ROUTES.state.pending = { canvasId: 'blocked-canvas', title: '第二张', blocked: false }
const nextTick = takeFollowerTick()
check('the follower schedules its next poll', typeof nextTick === 'function')
if (typeof nextTick === 'function') {
  await nextTick()
  await settle()
}
const blocked = posts.find((post) => post.name === 'target' && post.body !== null && post.body.blocked === true)
check('a refused auto-open is reported back to the Host', blocked !== undefined && blocked.body.canvasId === 'blocked-canvas', JSON.stringify(blocked?.body ?? null))

check('a blocked open keeps the follower polling', timers.some((timer) => timer.ms === 5000))
const openCount = windowCalls.length
ROUTES.state.pending = { canvasId: 'fresh-canvas', title: '重新打开', at: 2 }
const reopenTick = takeFollowerTick()
sandbox.window.open = (url, name) => { windowCalls.push({ url, name }); return { opener: null } }
if (reopenTick) await reopenTick()
await settle()
check('the same canvas can be opened again on a new request', windowCalls.length === openCount + 1)

function findNode(node, predicate) {
  if (!node || typeof node !== 'object') return undefined
  if (predicate(node)) return node
  for (const child of Array.isArray(node.children) ? node.children : [node.children]) {
    const found = findNode(child, predicate)
    if (found) return found
  }
}
const keyInput = findNode(tree, (node) => node.type === 'input' && node.props.type === 'password')
check('API Key input is masked and labelled', Boolean(keyInput?.props.id) && keyInput.props.autoComplete === 'off')
keyInput.props.onChange({ target: { type: 'password', value: 'ic_client_test_key' } })
effects.length = 0
tree = mount({ type: seat.component, props: { t }, children: [] }, 'root')
for (const effect of effects) effect()
findNode(tree, (node) => node.type === 'form').props.onSubmit({ preventDefault() {} })
await settle()
check('form verifies Key against the displayed deployment', posts.some((post) => post.name === 'canvas-key' && post.body.key === 'ic_client_test_key' && post.body.canvasBaseUrl === 'https://canvas.example.com'))

for (const dispose of disposers) dispose()

const failed = checks.filter((entry) => !entry.ok)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
if (failed.length > 0) process.exitCode = 1
