/**
 * Browser half of the Infinite Canvas bundle.
 *
 * Registers exactly one seat — `settings.section`, the page in the Settings
 * dialog — plus a background effect that follows the Host's pending canvas and
 * navigates the single canvas tab to it. There is no workspace panel: the canvas
 * is a page in the browser, and this bundle only configures and connects it.
 *
 * The canvas is a third-party Web application served by a deployment the user
 * configures, and it is deliberately NOT embedded. A cross-site iframe cannot
 * carry that site's login session (third-party cookie isolation), so the canvas
 * app would render its login screen, never start, and never reach the local
 * agent. The panel therefore opens the real canvas in an ordinary browser tab
 * with the agent URL and token in the address hash — the handshake the official
 * `canvas-agent open` performs. The surrounding chrome is ordinary Harness UI
 * styled with theme tokens.
 */
window.__ModuleLoader__.load({
  id: 'dsh-infinite-canvas',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useId, useRef, useState } = React

    const PANEL_ID = 'infinite-canvas'
    const NS = 'infinite-canvas'
    const API_ROOT = '/infinite-canvas'

    /**
     * One named browsing context for the canvas, so "open canvas" navigates the
     * same tab instead of piling up tabs. Two connected canvases leave the agent
     * unable to tell which one is meant, so the tab must stay singular.
     */
    const CANVAS_TAB = 'dsh-infinite-canvas'

    const MESSAGES = {
  "nav.label": [
    "无限画布",
    "Infinite Canvas"
  ],
  "settings.title": [
    "无限画布",
    "Infinite Canvas"
  ],
  "settings.intro": [
    "连接画布站，让智能体在画布上工作。",
    "Connect your canvas and let the agent work on it."
  ],
  "open.button": [
    "打开画布",
    "Open canvas"
  ],
  "action.refresh": [
    "刷新状态",
    "Refresh status"
  ],
  "panel.pending": [
    "等待打开：{title}",
    "Ready to open: {title}"
  ],
  "panel.blocked": [
    "浏览器阻止了自动打开，请点击链接继续。",
    "The browser blocked automatic opening. Use the link to continue."
  ],
  "form.heading": [
    "站点连接",
    "Deployment"
  ],
  "form.baseUrl": [
    "画布站地址",
    "Canvas URL"
  ],
  "form.key": [
    "用户 API Key",
    "User API Key"
  ],
  "form.keyHint": [
    "在画布站「账户 → API Key」创建；读取需 read，新建需 read + write。",
    "Create it in the canvas account → API Key. Listing needs read; creating needs read + write."
  ],
  "form.keyPresent": [
    "已保存，留空保留",
    "Saved; leave blank to keep"
  ],
  "form.keyMissing": [
    "粘贴 ic_ 开头的 Key",
    "Paste a key starting with ic_"
  ],
  "form.save": [
    "验证并保存",
    "Verify & save"
  ],
  "form.saving": [
    "正在验证…",
    "Verifying…"
  ],
  "form.saved": [
    "连接配置已保存",
    "Connection saved"
  ],
  "form.clear": [
    "移除 Key",
    "Remove key"
  ],
  "form.env": [
    "Key 由 CANVAS_API_KEY 环境变量提供。",
    "Key provided through CANVAS_API_KEY."
  ],
  "form.privacy": [
    "Key 仅在本机保存，直接由插件请求已配置的站点。",
    "The key is stored locally and sent by the plugin to the configured site."
  ],
  "form.advanced": [
    "高级设置",
    "Advanced settings"
  ],
  "form.agentUrl": [
    "本地 Agent 地址",
    "Local agent URL"
  ],
  "form.autoStart": [
    "随 Harness 启动 Agent",
    "Start agent with Harness"
  ],
  "form.embed": [
    "打开时自动连接本地 Agent",
    "Connect to local agent when opening"
  ],
  "status.heading": [
    "连接状态",
    "Connection"
  ],
  "status.agent": [
    "本地 Agent",
    "Local agent"
  ],
  "status.canvas": [
    "画布连接",
    "Canvas connection"
  ],
  "status.key": [
    "API Key",
    "API Key"
  ],
  "status.yes": [
    "已就绪",
    "Ready"
  ],
  "status.no": [
    "未连接",
    "Disconnected"
  ],
  "status.configured": [
    "已配置",
    "Configured"
  ],
  "status.missing": [
    "待配置",
    "Needs setup"
  ],
  "status.tools": [
    "{count} 个画布工具可用",
    "{count} canvas tools available"
  ],
  "status.hint": [
    "画布编辑需要在浏览器打开一张画布；只保留一个连接的标签页。",
    "Live editing needs one canvas open in the browser. Keep only one connected tab."
  ],
  "status.log": [
    "诊断日志",
    "Diagnostics"
  ],
  "action.startAgent": [
    "启动 Agent",
    "Start agent"
  ],
  "action.stopAgent": [
    "停止 Agent",
    "Stop agent"
  ],
  "status.starting": [
    "正在启动 Agent…",
    "Starting agent…"
  ],
  "status.external": [
    "Agent 由外部进程运行",
    "Agent running externally"
  ],
  "projects.title": [
    "我的画布",
    "My canvases"
  ],
  "projects.refresh": [
    "刷新列表",
    "Refresh list"
  ],
  "projects.loading": [
    "正在读取画布…",
    "Loading canvases…"
  ],
  "projects.empty": [
    "还没有画布。连接后可让智能体新建一张。",
    "No canvases yet. Ask the agent to create one after connecting."
  ],
  "projects.noKey": [
    "保存 API Key 后，这里会显示账户的画布。",
    "Save an API Key to see your canvases."
  ],
  "projects.nodes": [
    "{count} 个节点",
    "{count} nodes"
  ],
  "projects.open": [
    "打开",
    "Open"
  ],
  "projects.untitled": [
    "未命名画布",
    "Untitled canvas"
  ]
}
    MESSAGES['form.agentHint'] = ['更改端口后，也需在 MCP 行配置中同步 CANVAS_AGENT_PORT 并重启 Harness。', 'When changing the port, also update CANVAS_AGENT_PORT in the MCP row and restart Harness.']
    const DICTIONARIES = Object.fromEntries(['zh', 'en'].map((lang, index) =>
      [lang, Object.fromEntries(Object.entries(MESSAGES).map(([key, value]) => [key, value[index]]))],
    ))

    const css = `
.dsh-ic-page{color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:1.5;container-type:inline-size;min-width:0}
.dsh-ic-page *{box-sizing:border-box}
.dsh-ic-section{display:flex;flex-direction:column;gap:18px;width:100%;max-width:820px;padding:0 2px 24px}
.dsh-ic-header,.dsh-ic-bar,.dsh-ic-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-width:0}
.dsh-ic-header{justify-content:space-between;align-items:flex-start}
.dsh-ic-title{margin:0;font-size:16px;font-weight:650;line-height:1.4;letter-spacing:-.02em;overflow-wrap:anywhere}
.dsh-ic-header h2{font-size:22px;margin-bottom:4px}
.dsh-ic-muted{margin:0;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.dsh-ic-card{padding:20px;border:1px solid color-mix(in srgb,var(--dsw-alias-label-secondary) 14%,transparent);border-radius:16px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 80%,var(--dsw-alias-bg-base));min-width:0;display:flex;flex-direction:column;gap:16px}
.dsh-ic-spacer{flex:1 1 auto}
.dsh-ic-button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:36px;padding:7px 13px;border-radius:9px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;font-weight:550;cursor:pointer;text-decoration:none;white-space:nowrap}
.dsh-ic-button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}
.dsh-ic-button:active:not(:disabled){transform:translateY(1px)}
.dsh-ic-button:focus-visible,.dsh-ic-input:focus-visible,.dsh-ic-page summary:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:3px}
.dsh-ic-button:disabled{opacity:.5;cursor:not-allowed}
.dsh-ic-button--primary{background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));border-color:transparent;color:var(--dsw-alias-label-primary-foreground,#f5f6f8)}
.dsh-ic-button--primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-brand-primary));color:var(--dsw-alias-label-primary-foreground,#f5f6f8)}
.dsh-ic-field{display:flex;flex-direction:column;gap:7px;min-width:0}
.dsh-ic-label{font-size:12px;font-weight:600}
.dsh-ic-input{width:100%;min-width:0;height:40px;padding:0 12px;border-radius:9px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit}
.dsh-ic-input::placeholder{color:var(--dsw-alias-label-secondary);opacity:1}
.dsh-ic-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.dsh-ic-check{display:flex;align-items:center;gap:8px;min-height:36px;font-size:12px;cursor:pointer}
.dsh-ic-check input{accent-color:var(--dsw-alias-brand-primary)}
.dsh-ic-error{margin:0;color:var(--dsw-alias-state-error-primary);font-size:12px;overflow-wrap:anywhere}
.dsh-ic-ok{margin:0;color:var(--dsw-alias-state-success-primary);font-size:12px}
.dsh-ic-status{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.dsh-ic-status-item{padding:11px 13px;background:var(--dsw-alias-bg-layer-1);border-radius:11px;min-width:0}
.dsh-ic-status-value{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;margin-top:5px}
.dsh-ic-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-label-secondary);flex-shrink:0}
.dsh-ic-dot--ready{background:var(--dsw-alias-state-success-primary)}
.dsh-ic-project{display:flex;align-items:center;gap:12px;padding:12px 0;border-top:1px solid var(--dsw-alias-border-l1);min-width:0}
.dsh-ic-project-title{font-size:13px;font-weight:550;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-ic-list{display:flex;flex-direction:column;min-width:0}
.dsh-ic-page summary{cursor:pointer;font-size:12px;font-weight:550;min-height:36px;padding:7px 0;color:var(--dsw-alias-label-secondary)}
.dsh-ic-details-body{display:flex;flex-direction:column;gap:12px;padding-top:12px}
.dsh-ic-log{margin:0;max-height:150px;overflow:auto;padding:12px;border-radius:9px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);font:11px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere}
@container (max-width:420px){.dsh-ic-card{padding:16px}.dsh-ic-status{grid-template-columns:minmax(0,1fr)}.dsh-ic-status-item{display:flex;justify-content:space-between;align-items:center}.dsh-ic-status-value{margin:0}.dsh-ic-button{min-height:44px}.dsh-ic-input{height:44px}}
@media(prefers-reduced-motion:reduce){.dsh-ic-page *{transition:none!important;animation:none!important}.dsh-ic-button:active:not(:disabled){transform:none}}
`

    function Styles() {
      return h('style', { 'data-dsh-infinite-canvas': '' }, css)
    }

    /** Same-origin API path, resolved against the page base like the host does. */
    function apiPath(name) {
      const relative = `${API_ROOT}/${name}`.replace(/^\/+/, '')
      if (typeof document === 'undefined' || typeof document.baseURI !== 'string') return `/${relative}`
      return new URL(relative, document.baseURI).pathname
    }

    async function callApi(name, init) {
      const response = await fetch(apiPath(name), { cache: 'no-store', ...init })
      let body
      try {
        body = await response.json()
      } catch {
        body = undefined
      }
      if (!response.ok) {
        const message = body !== undefined && typeof body.error === 'string' ? body.error : `HTTP ${response.status}`
        throw new Error(message)
      }
      return body
    }

    const readState = () => callApi('state')
    const readAgent = () => callApi('agent')
    const saveSettings = (patch) =>
      callApi('settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      })
    const readLink = () => callApi('link', { method: 'POST' })
    const readProjects = () => callApi('projects')
    const saveCanvasKey = (key, canvasBaseUrl) =>
      callApi('canvas-key', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key, canvasBaseUrl }),
      })


    /** Read the effective settings plus the live agent probe. */
    function useCanvas() {
      const [state, setState] = useState(null)
      const [agent, setAgent] = useState(null)
      const [link, setLink] = useState(null)
      const [error, setError] = useState('')
      const alive = useRef(true)
      const refresh = useCallback(async () => {
        try {
          const next = await readState()
          if (!alive.current) return
          setState(next)
          setError('')
          if (next.tokenAvailable === true) {
            try {
              const payload = await readLink()
              if (alive.current) setLink(payload === undefined ? null : payload)
            } catch {
              if (alive.current) setLink(null)
            }
          } else if (alive.current) {
            setLink(null)
          }
        } catch (failure) {
          if (alive.current) setError(failure instanceof Error ? failure.message : String(failure))
        }
        try {
          const probe = await readAgent()
          if (alive.current) setAgent(probe)
        } catch (failure) {
          if (alive.current) {
            setAgent({ running: false, connected: false, tools: [], error: failure instanceof Error ? failure.message : String(failure) })
          }
        }
      }, [])

      /** Poll faster while the agent is coming up, slowly otherwise. */
      useEffect(() => {
        alive.current = true
        void refresh()
        let timer
        const tick = async () => {
          if (!alive.current) return
          await refresh()
          if (!alive.current) return
          timer = setTimeout(() => void tick(), 5000)
        }
        timer = setTimeout(() => void tick(), 5000)
        return () => {
          alive.current = false
          clearTimeout(timer)
        }
      }, [refresh])

      /** Start or stop the supervisor-managed agent, then show its answer. */
      const act = useCallback(async (action) => {
        try {
          const probe = await callApi(`agent/${action}`, { method: 'POST' })
          if (alive.current && probe !== undefined) setAgent(probe)
        } catch (failure) {
          if (alive.current) setError(failure instanceof Error ? failure.message : String(failure))
        }
      }, [])

      return { state, agent, link, error, refresh, act, setState }
    }

    /**
     * An anchor that targets the single canvas tab. A plain named `target`
     * already makes the browser reuse that tab; the click handler does the same
     * through `window.open` so the opener link can be dropped explicitly.
     * Modified clicks (⌘/Ctrl/Shift/middle) are left to the browser.
     */
    function CanvasLink({ href, className, children, onBeforeOpen }) {
      const onClick = (event) => {
        if (event.defaultPrevented) return
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        if (typeof onBeforeOpen === 'function') {
          try {
            onBeforeOpen()
          } catch {
            // Remembering the target must never block opening it.
          }
        }
        let opened = null
        try {
          opened = window.open(href, CANVAS_TAB)
        } catch {
          opened = null
        }
        if (opened === null) {
          window.location.assign(href)
          return
        }
        try {
          opened.opener = null
        } catch {
          // Cross-origin assignment is not always allowed; the name still works.
        }
        try {
          opened.focus()
        } catch {
          // Focus is best effort.
        }
      }
      return h(
        'a',
        {
          className,
          href,
          target: CANVAS_TAB,
          rel: 'noopener',
          onClick,
        },
        children,
      )
    }

    function Field({ label, hint, htmlFor, children }) {
      return h(
        'div',
        { className: 'dsh-ic-field' },
        h('label', { className: 'dsh-ic-label', htmlFor }, label),
        children,
        hint === undefined || hint === null ? null : h('p', { className: 'dsh-ic-muted' }, hint),
      )
    }

    function SettingsForm({ t, state, onSaved }) {
      const uid = useId()
      const [baseUrl, setBaseUrl] = useState('')
      const [agentUrl, setAgentUrl] = useState('')
      const [autoStart, setAutoStart] = useState(true)
      const [embed, setEmbed] = useState(true)
      const [key, setKey] = useState('')
      const [dirty, setDirty] = useState(false)
      const [busy, setBusy] = useState(false)
      const [failure, setFailure] = useState('')
      const [message, setMessage] = useState('')
      const configured = state?.apiKeyAvailable === true
      const envKey = state?.apiKeySource === 'env'
      useEffect(() => {
        if (!state || dirty) return
        setBaseUrl(state.canvasBaseUrl)
        setAgentUrl(state.agentUrl)
        setAutoStart(state.autoStart !== false)
        setEmbed(state.embedCredentials !== false)
      }, [state, dirty])
      const change = (setter) => (event) => {
        setDirty(true)
        setMessage('')
        setter(event.target.type === 'checkbox' ? event.target.checked : event.target.value)
      }
      const submit = async (clear = false) => {
        setBusy(true)
        setFailure('')
        setMessage('')
        try {
          if (clear) {
            onSaved(await saveCanvasKey(''))
          } else {
            if (key.trim()) await saveCanvasKey(key, baseUrl)
            else if (!configured) throw new Error(t('form.keyMissing'))
            onSaved(await saveSettings({ canvasBaseUrl: baseUrl, agentUrl, autoStart, embedCredentials: embed }))
          }
          setKey('')
          setDirty(false)
          setMessage(t('form.saved'))
        } catch (error) {
          setFailure(error instanceof Error ? error.message : String(error))
        } finally {
          setBusy(false)
        }
      }
      return h('form', { className: 'dsh-ic-card', onSubmit: (event) => { event.preventDefault(); if (!busy) void submit() } },
        h('h3', { className: 'dsh-ic-title' }, t('form.heading')),
        h(Field, { label: t('form.baseUrl'), htmlFor: `${uid}-base` },
          h('input', { id: `${uid}-base`, type: 'url', required: true, className: 'dsh-ic-input', value: baseUrl, spellCheck: false, onChange: change(setBaseUrl) })),
        h(Field, { label: t('form.key'), htmlFor: `${uid}-key`, hint: t('form.keyHint') },
          h('input', { id: `${uid}-key`, type: 'password', className: 'dsh-ic-input', value: key, spellCheck: false, autoComplete: 'off', placeholder: t(configured ? 'form.keyPresent' : 'form.keyMissing'), onChange: change(setKey) })),
        envKey ? h('p', { className: 'dsh-ic-muted' }, t('form.env')) : null,
        h('p', { className: 'dsh-ic-muted' }, t('form.privacy')),
        h('details', null,
          h('summary', null, t('form.advanced')),
          h('div', { className: 'dsh-ic-details-body' },
            h(Field, { label: t('form.agentUrl'), htmlFor: `${uid}-agent`, hint: t('form.agentHint') },
              h('input', { id: `${uid}-agent`, type: 'url', required: true, className: 'dsh-ic-input', value: agentUrl, onChange: change(setAgentUrl) })),
            h('label', { className: 'dsh-ic-check' }, h('input', { type: 'checkbox', checked: autoStart, onChange: change(setAutoStart) }), t('form.autoStart')),
            h('label', { className: 'dsh-ic-check' }, h('input', { type: 'checkbox', checked: embed, onChange: change(setEmbed) }), t('form.embed')))),
        failure ? h('p', { className: 'dsh-ic-error', role: 'alert' }, failure) : null,
        message ? h('p', { className: 'dsh-ic-ok', role: 'status' }, message) : null,
        h('div', { className: 'dsh-ic-row' },
          h('button', { type: 'submit', className: 'dsh-ic-button dsh-ic-button--primary', disabled: busy || !state }, t(busy ? 'form.saving' : 'form.save')),
          configured && !envKey ? h('button', { type: 'button', className: 'dsh-ic-button', disabled: busy, onClick: () => void submit(true) }, t('form.clear')) : null),
      )
    }

    function StatusList({ t, state, agent }) {
      const rows = [
        ['status.key', state?.apiKeyAvailable, 'status.configured', 'status.missing'],
        ['status.agent', agent?.running, 'status.yes', 'status.no'],
        ['status.canvas', agent?.connected, 'status.yes', 'status.no'],
      ]
      return h('div', { className: 'dsh-ic-status', 'aria-label': t('status.heading') },
        rows.map(([label, ready, yes, no]) => h('div', { className: 'dsh-ic-status-item', key: label },
          h('span', { className: 'dsh-ic-muted' }, t(label)),
          h('span', { className: 'dsh-ic-status-value' }, h('span', { className: `dsh-ic-dot${ready ? ' dsh-ic-dot--ready' : ''}`, 'aria-hidden': true }), t(ready ? yes : no)))))
    }

    function ProjectList({ t, state, link }) {
      const [projects, setProjects] = useState(null)
      const [failure, setFailure] = useState('')
      const [busy, setBusy] = useState(false)
      const available = state?.apiKeyAvailable === true
      const revision = state?.apiKeyRevision
      const baseUrl = state?.canvasBaseUrl
      const latest = useRef(0)
      const load = useCallback(async () => {
        const request = ++latest.current
        setFailure('')
        if (!available) { setProjects(null); return }
        setBusy(true)
        try {
          const payload = await readProjects()
          if (latest.current === request) setProjects(payload.projects)
        } catch (error) {
          if (latest.current === request) { setProjects(null); setFailure(error instanceof Error ? error.message : String(error)) }
        } finally {
          if (latest.current === request) setBusy(false)
        }
      }, [available, baseUrl, revision])
      useEffect(() => { void load(); return () => { latest.current++ } }, [load])
      return h('section', { className: 'dsh-ic-card', 'aria-busy': busy },
        h('div', { className: 'dsh-ic-bar' }, h('h3', { className: 'dsh-ic-title' }, t('projects.title')),
          h('span', { className: 'dsh-ic-spacer' }),
          h('button', { className: 'dsh-ic-button', type: 'button', disabled: !available || busy, onClick: () => void load() }, t('projects.refresh'))),
        !available ? h('p', { className: 'dsh-ic-muted' }, t('projects.noKey'))
          : failure ? h('p', { className: 'dsh-ic-error', role: 'alert' }, failure)
          : busy ? h('p', { className: 'dsh-ic-muted', role: 'status' }, t('projects.loading'))
          : projects?.length ? h('div', { className: 'dsh-ic-list' }, projects.map((project) =>
              h('div', { className: 'dsh-ic-project', key: project.id },
                h('div', { style: { minWidth: 0, flex: 1 } },
                  h('div', { className: 'dsh-ic-project-title', title: project.title }, project.title || t('projects.untitled')),
                  h('p', { className: 'dsh-ic-muted' }, t('projects.nodes', { count: project.nodeCount }))),
                h(CanvasLink, { className: 'dsh-ic-button', href: withCanvasId(openLinkOf(link, state), project.id) }, t('projects.open')))))
          : h('p', { className: 'dsh-ic-muted' }, t('projects.empty')))
    }

    /** The credentialed link the Host built, or the plain list url. */
    function openLinkOf(link, state) {
      if (link !== null && typeof link.url === 'string' && link.url !== '') return link.url
      return state !== null && typeof state.canvasUrl === 'string' ? state.canvasUrl : ''
    }

    /** The credentialed link for one canvas, reusing the hash the Host built. */
    function withCanvasId(base, canvasId) {
      if (typeof base !== 'string' || base === '' || canvasId === '') return ''
      try {
        const url = new URL(base)
        url.pathname = url.pathname.replace(/\/canvas\/?$/, `/canvas/${canvasId}`)
        return url.toString()
      } catch {
        return ''
      }
    }

    function SettingsSection({ t }) {
      const { state, agent, link, error, refresh, act, setState } = useCanvas()
      const openUrl = openLinkOf(link, state)
      const pending = state?.pending
      const pendingUrl = pending?.canvasId ? withCanvasId(openUrl, pending.canvasId) : ''
      return h('div', { className: 'dsh-ic-page' }, h(Styles),
        h('div', { className: 'dsh-ic-section' },
          h('header', { className: 'dsh-ic-header' },
            h('div', null, h('h2', { className: 'dsh-ic-title' }, t('settings.title')), h('p', { className: 'dsh-ic-muted' }, t('settings.intro'))),
            openUrl ? h(CanvasLink, { className: 'dsh-ic-button dsh-ic-button--primary', href: openUrl }, t('open.button')) : null),
          h(StatusList, { t, state, agent }),
          pendingUrl ? h('div', { className: 'dsh-ic-row' },
            h('p', { className: 'dsh-ic-muted' }, t('panel.pending', { title: pending.title || pending.canvasId })),
            h(CanvasLink, { className: 'dsh-ic-button', href: pendingUrl }, t('open.button')),
            pending.blocked ? h('p', { className: 'dsh-ic-muted' }, t('panel.blocked')) : null) : null,
          error ? h('p', { className: 'dsh-ic-error', role: 'alert' }, error) : null,
          h(SettingsForm, { t, state, onSaved: (next) => { setState(next); void refresh() } }),
          h(ProjectList, { t, state, link }),
          h('section', { className: 'dsh-ic-card' },
            h('div', { className: 'dsh-ic-bar' }, h('h3', { className: 'dsh-ic-title' }, t('status.heading')),
              h('span', { className: 'dsh-ic-spacer' }),
              h('button', { type: 'button', className: 'dsh-ic-button', onClick: () => void refresh() }, t('action.refresh'))),
            h('p', { className: 'dsh-ic-muted' }, agent?.connected ? t('status.tools', { count: agent.tools.length }) : t('status.hint')),
            h('div', { className: 'dsh-ic-row' },
              agent?.phase === 'starting' ? h('button', { type: 'button', className: 'dsh-ic-button', disabled: true }, t('status.starting'))
                : agent?.managed && agent.running ? h('button', { type: 'button', className: 'dsh-ic-button', onClick: () => void act('stop') }, t('action.stopAgent'))
                : agent?.phase === 'external' ? h('span', { className: 'dsh-ic-muted' }, t('status.external'))
                : h('button', { type: 'button', className: 'dsh-ic-button', onClick: () => void act('start') }, t('action.startAgent'))),
            h('details', null, h('summary', null, t('status.log')),
              h('pre', { className: 'dsh-ic-log' }, [agent?.error, ...(agent?.log ?? [])].filter(Boolean).join('\n'))))))
    }


    return {
      name: 'dsh-infinite-canvas',
      inject: ['slots', 'locale', 'theme'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, DICTIONARIES), 'dsh-infinite-canvas: dictionaries')
        const t = ctx.locale.bind(NS)

        /**
         * The canvas tab follower. It lives here, not in a panel, because this
         * bundle loads with the app (`client.immediately`): when the Host leaves
         * a pending canvas, this navigates the single named canvas tab to it —
         * navigating an already-open named window needs no user gesture, so the
         * agent keeps exactly one canvas session and no second tab appears.
         */
        ctx.effect(() => {
          let alive = true
          let timer
          let lastHandled = ''
          const tick = async () => {
            if (!alive) return
            try {
              const state = await readState()
              const pending = state?.pending
              const canvasId = typeof pending?.canvasId === 'string' ? pending.canvasId : ''
              const revision = `${canvasId}:${pending?.at ?? ''}`
              if (canvasId && !pending.blocked && revision !== lastHandled) {
                const payload = await callApi('link', {
                  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ canvasId }),
                })
                if (payload?.url && alive) {
                  const opened = window.open(payload.url, CANVAS_TAB)
                  await callApi('target', {
                    method: 'POST', headers: { 'content-type': 'application/json' },
                    body: JSON.stringify(opened === null ? { canvasId, title: pending.title, blocked: true } : { canvasId: '' }),
                  })
                  // A blocked report gets a new timestamp on Host; do not retry it automatically.
                  lastHandled = revision
                  if (opened !== null) {
                    try { opened.opener = null } catch { /* Cross-origin window. */ }
                  }
                }
              }
            } catch {
              // Retry transient Host failures on the next poll.
            } finally {
              if (alive) timer = setTimeout(() => void tick(), 5000)
            }
          }
          timer = setTimeout(() => void tick(), 2500)
          return () => {
            alive = false
            clearTimeout(timer)
          }
        }, 'dsh-infinite-canvas: canvas tab follower')

        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            { name: 'settings.section', id: PANEL_ID, order: 64, label: () => t('nav.label'), locale: NS, inject: () => ({ t }) },
            SettingsSection,
          ),
        )
      },
    }
  },
})
