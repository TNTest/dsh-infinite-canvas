/** Settings for backend API access and an independent optional web-Agent launcher. */
window.__ModuleLoader__.load({
  id: 'dsh-infinite-canvas',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useId, useRef, useState } = React

    const PANEL_ID = 'infinite-canvas'
    const NS = 'infinite-canvas'
    const API_ROOT = '/infinite-canvas'

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
    "通过 API 直接操作已保存的画布；网页端 Agent 可独立启动。",
    "Work on saved canvases through the API; launch the web Agent independently."
  ],
  "open.button": [
    "查看画布",
    "View canvases"
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
    "在画布站「账户 → API Key」创建；读取需 read，编辑需 read + write，生成另需 generate。",
    "Create it in Account → API Key. Reading needs read; editing needs read + write; generation also needs generate."
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
  ],
  "status.backend": [
    "后端 API",
    "Backend API"
  ],
  "status.backendHint": [
    "节点、连线和布局操作无需浏览器或本地 Agent。网页已打开时，请先保存改动，API 操作完成后刷新查看。",
    "Node, connection and layout tools need no browser or local Agent. Save browser edits first, then reload after API edits."
  ],
  "status.testing": [
    "检查连接",
    "Check connection"
  ],
  "web.title": [
    "网页端本地 Agent（可选）",
    "Local Agent for the web app (optional)"
  ],
  "web.hint": [
    "供画布网页右侧的本地智能体使用，和后端 API 工具独立运行。",
    "For the local assistant in the canvas web app. Runs independently of backend API tools."
  ],
  "web.open": [
    "打开网页并连接 Agent",
    "Open web app with Agent"
  ],
  "web.options": [
    "网页端连接选项",
    "Web connection options"
  ],
  "web.save": [
    "保存启动选项",
    "Save launch options"
  ],
  "web.running": [
    "已启动",
    "Running"
  ],
  "web.stopped": [
    "未启动，不影响 API 操作",
    "Stopped; API tools remain available"
  ],
  "form.agentHint": [
    "网页端连接地址，后端 API 操作不使用此地址。",
    "Connection address for the web app; backend API tools do not use it."
  ]
}
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
.dsh-ic-status{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
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
    const readConnection = () => callApi('connection')
    const saveSettings = (patch) =>
      callApi('settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      })
    const readLink = () => callApi('link', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ webAgent: true }) })
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
      const [connection, setConnection] = useState(null)
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

      const testConnection = useCallback(async () => {
        try { const result = await readConnection(); if (alive.current) setConnection(result) }
        catch (error) { if (alive.current) setConnection({ connected: false, error: error.message }) }
      }, [])
      useEffect(() => { void testConnection() }, [testConnection])

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

      return { state, agent, link, connection, error, refresh, testConnection, act, setState }
    }

    function CanvasLink({ href, className, children }) {
      return h('a', { className, href, target: '_blank', rel: 'noopener noreferrer' }, children)
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
            onSaved(await saveSettings({ canvasBaseUrl: baseUrl }))
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
        failure ? h('p', { className: 'dsh-ic-error', role: 'alert' }, failure) : null,
        message ? h('p', { className: 'dsh-ic-ok', role: 'status' }, message) : null,
        h('div', { className: 'dsh-ic-row' },
          h('button', { type: 'submit', className: 'dsh-ic-button dsh-ic-button--primary', disabled: busy || !state }, t(busy ? 'form.saving' : 'form.save')),
          configured && !envKey ? h('button', { type: 'button', className: 'dsh-ic-button', disabled: busy, onClick: () => void submit(true) }, t('form.clear')) : null),
      )
    }

    function StatusList({ t, state, connection }) {
      const rows = [
        ['status.key', state?.apiKeyAvailable, 'status.configured', 'status.missing'],
        ['status.backend', connection?.connected, 'status.yes', 'status.no'],
      ]
      return h('div', { className: 'dsh-ic-status', 'aria-label': t('status.heading') },
        rows.map(([label, ready, yes, no]) => h('div', { className: 'dsh-ic-status-item', key: label },
          h('span', { className: 'dsh-ic-muted' }, t(label)),
          h('span', { className: 'dsh-ic-status-value' }, h('span', { className: `dsh-ic-dot${ready ? ' dsh-ic-dot--ready' : ''}`, 'aria-hidden': true }), t(ready ? yes : no)))))
    }

    function WebAgentSection({ t, state, agent, link, act, onSaved }) {
      const uid = useId()
      const [agentUrl, setAgentUrl] = useState('')
      const [autoStart, setAutoStart] = useState(true)
      const [embed, setEmbed] = useState(true)
      const [dirty, setDirty] = useState(false)
      const [busy, setBusy] = useState(false)
      const [failure, setFailure] = useState('')
      useEffect(() => {
        if (!state || dirty) return
        setAgentUrl(state.agentUrl); setAutoStart(state.autoStart !== false); setEmbed(state.embedCredentials !== false)
      }, [state, dirty])
      const save = async (event) => {
        event.preventDefault(); setBusy(true); setFailure('')
        try { onSaved(await saveSettings({ agentUrl, autoStart, embedCredentials: embed })); setDirty(false) }
        catch (error) { setFailure(error.message) }
        finally { setBusy(false) }
      }
      return h('section', { className: 'dsh-ic-card' },
        h('h3', { className: 'dsh-ic-title' }, t('web.title')),
        h('p', { className: 'dsh-ic-muted' }, t('web.hint')),
        h('p', { className: 'dsh-ic-muted', role: 'status' }, t(agent?.running ? 'web.running' : 'web.stopped')),
        h('div', { className: 'dsh-ic-row' },
          agent?.phase === 'starting' ? h('button', { type: 'button', className: 'dsh-ic-button', disabled: true }, t('status.starting'))
          : agent?.running && agent.managed ? h('button', { type: 'button', className: 'dsh-ic-button', onClick: () => void act('stop') }, t('action.stopAgent'))
          : agent?.phase === 'external' ? h('span', { className: 'dsh-ic-muted' }, t('status.external'))
          : h('button', { type: 'button', className: 'dsh-ic-button', onClick: () => void act('start') }, t('action.startAgent')),
          agent?.running && link?.url ? h(CanvasLink, { className: 'dsh-ic-button', href: link.url }, t('web.open')) : null),
        h('details', null, h('summary', null, t('web.options')),
          h('form', { className: 'dsh-ic-details-body', onSubmit: save },
            h(Field, { label: t('form.agentUrl'), hint: t('form.agentHint'), htmlFor: `${uid}-agent` },
              h('input', { className: 'dsh-ic-input', id: `${uid}-agent`, type: 'url', required: true, value: agentUrl, onChange: (e) => { setDirty(true); setAgentUrl(e.target.value) } })),
            h('label', { className: 'dsh-ic-check' }, h('input', { type: 'checkbox', checked: autoStart, onChange: (e) => { setDirty(true); setAutoStart(e.target.checked) } }), t('form.autoStart')),
            h('label', { className: 'dsh-ic-check' }, h('input', { type: 'checkbox', checked: embed, onChange: (e) => { setDirty(true); setEmbed(e.target.checked) } }), t('form.embed')),
            failure ? h('p', { className: 'dsh-ic-error', role: 'alert' }, failure) : null,
            h('button', { type: 'submit', className: 'dsh-ic-button', disabled: busy || !state }, t('web.save')))),
        h('details', null, h('summary', null, t('status.log')), h('pre', { className: 'dsh-ic-log' }, [agent?.error, ...(agent?.log ?? [])].filter(Boolean).join('\n'))))
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
                h(CanvasLink, { className: 'dsh-ic-button', href: withCanvasId(state?.canvasUrl, project.id) }, t('projects.open')))))
          : h('p', { className: 'dsh-ic-muted' }, t('projects.empty')))
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
      const { state, agent, link, connection, error, refresh, testConnection, act, setState } = useCanvas()
      const onSaved = (next) => { setState(next); void refresh(); void testConnection() }
      return h('div', { className: 'dsh-ic-page' }, h(Styles),
        h('div', { className: 'dsh-ic-section' },
          h('header', { className: 'dsh-ic-header' },
            h('div', null, h('h2', { className: 'dsh-ic-title' }, t('settings.title')), h('p', { className: 'dsh-ic-muted' }, t('settings.intro'))),
            h('div', { className: 'dsh-ic-actions' },
              h('button', { type: 'button', className: 'dsh-ic-button', onClick: () => void testConnection() }, t('status.testing')),
              state?.canvasUrl ? h(CanvasLink, { className: 'dsh-ic-button', href: state.canvasUrl }, t('open.button')) : null)),
          h(StatusList, { t, state, connection }),
          h('p', { className: 'dsh-ic-muted' }, t('status.backendHint')),
          connection?.error ? h('p', { className: 'dsh-ic-error', role: 'alert' }, connection.error) : null,
          error ? h('p', { className: 'dsh-ic-error', role: 'alert' }, error) : null,
          h(SettingsForm, { t, state, onSaved }),
          h(WebAgentSection, { t, state, agent, link, act, onSaved }),
          h(ProjectList, { t, state, link: null })))
    }


    return {
      name: 'dsh-infinite-canvas',
      inject: ['slots', 'locale', 'theme'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, DICTIONARIES), 'dsh-infinite-canvas: dictionaries')
        const t = ctx.locale.bind(NS)

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
