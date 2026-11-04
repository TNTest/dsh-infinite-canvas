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

    /**
     * Shown in the settings page: prints only the signed-in user's own token,
     * never the whole persisted record.
     */
    const TOKEN_SNIPPET = `Object.entries(localStorage).forEach(([key, value]) => {
  try {
    const { state = {} } = JSON.parse(value)
    if (state.token) console.log(state.token)
  } catch {}
})`

    const DICTIONARIES = {
      zh: {
        'nav.label': '无限画布',
        'action.refresh': '刷新',
        'open.button': '打开画布',
        'panel.pending': 'Agent 新建了《{title}》——切到这张画布：',
        'panel.blocked': '浏览器拦下了自动打开，Agent 也会在对话里给出可直接点的链接。',
        'open.keepOpen': '「打开画布」始终复用同一个标签页；Agent 新建画布后也会自动把该标签页切过去。Agent 同一时刻只认一个画布，多开标签页会让它无法判断目标。',
        'check.title': '画布列表',
        'check.hint': '列出账号下的画布，也用来验证 Token。插件不记录任何画布 ID；Agent 新建画布后会自动把同一个标签页切过去。',
        'check.noToken': '未配置画布站 API Token：在下面「配置」里填入后，这里会列出账号下的画布。',
        'check.ok': 'Token 有效 · {count} 个画布',
        'check.empty': '账号下还没有画布——请在画布页里新建一个。',
        'check.refresh': '刷新',
        'check.nodes': '{count} 节点',
        'projects.loading': '读取中…',
        'token.title': '画布站 API Token',
        'token.hint': '用于读取画布列表（只读），以 Authorization: Bearer 发送给画布站。取法：在画布站页面按 F12 打开 Console，运行下面这段代码，复制打印出的 token。',
        'token.codeLabel': 'Console 代码',
        'token.copy': '复制代码',
        'token.copied': '已复制',
        'token.copyFailed': '复制失败',
        'token.save': '保存 Token',
        'token.clear': '清除 Token',
        'token.saved': 'Token 已保存',
        'token.present': '已配置',
        'token.missing': '未配置',
        'form.baseUrl': '画布站点地址',
        'form.baseUrlHint': '默认 {default}，可改为你自己的部署地址。',
        'form.agentUrl': '本地 Agent 地址',
        'form.agentUrlHint': '官方默认 http://127.0.0.1:3210。',
        'form.embed': '打开画布时自动带上连接凭证',
        'form.embedHint': '把本地 Agent 地址与 Token 写进打开的画布地址 hash，页面一开即连接；关闭后需要在画布页里手动填写。',
        'form.save': '保存',
        'form.reset': '恢复默认地址',
        'form.saved': '已保存',
        'form.saving': '保存中…',
        'form.error': '保存失败：{message}',
        'settings.title': '无限画布',
        'settings.intro': '在这里配置画布站点与本地 Canvas Agent 的连接方式。画布在浏览器标签页里打开，面板不内嵌；不需要填画布 ID——你在列表里打开哪个画布，插件就记住哪个。',
        'status.heading': '连接状态',
        'status.agent': '本地 Agent',
        'status.canvas': '画布连接',
        'status.openUrl': '打开地址',
        'status.token': '连接凭证',
        'status.tools': '画布工具',
        'status.yes': '正常',
        'status.no': '未就绪',
        'status.tokenFile': '读取自 {source}',
        'status.noToken': '未找到，请先启动本地 Canvas Agent',
        'status.hint': '在本机终端运行 npx -y @tigerowo/canvas-agent@latest 启动本地 Agent，再点上方「打开画布」，用浏览器打开带凭证的画布页并选一张画布即可连接。',
        'status.mcp': 'MCP 工具名格式：mcp__{server}__<工具>',
        'status.settingsPath': '设置文件：{path}',
        'action.startAgent': '启动 Agent',
        'action.stopAgent': '停止 Agent',
        'status.starting': '正在启动本地 Agent…',
        'status.external': 'Agent 已在外部运行',
        'status.log': '最近日志',
        'status.phase': '托管状态',
        'form.autoStart': '随 Harness 启动本地 Agent',
        'form.autoStartHint': '开启后插件会在 Harness 启动时自动拉起 npx -y @tigerowo/canvas-agent@latest，并在它崩溃后重启；关闭则只在点「启动 Agent」时运行。',
        'phase.idle': '未启动',
        'phase.starting': '启动中',
        'phase.running': '由 Harness 托管运行',
        'phase.external': '外部已运行',
        'phase.stopping': '停止中',
        'phase.stopped': '已停止',
        'phase.exited': '已退出',
        'phase.error': '启动失败',
      },
      en: {
        'nav.label': 'Infinite Canvas',
        'action.refresh': 'Refresh',
        'open.button': 'Open canvas',
        'panel.pending': 'The agent created 《{title}》 — switch to it:',
        'panel.blocked': 'The browser blocked the automatic switch; the agent also posts a one-click link in the chat.',
        'open.keepOpen': 'Open canvas always reuses one tab, and a canvas the agent creates is switched into it automatically. The agent serves a single canvas at a time, so extra tabs make it unable to pick a target.',
        'check.title': 'Canvases',
        'check.hint': 'Lists the account canvases and proves the token. No canvas id is stored; when the agent creates a canvas it switches this same tab to it automatically.',
        'check.noToken': 'No canvas API token yet: add one under Configure below and the account canvases appear here.',
        'check.ok': 'Token works · {count} canvases',
        'check.empty': 'No canvases on the account yet — create one in the canvas page.',
        'check.refresh': 'Refresh',
        'check.nodes': '{count} nodes',
        'projects.loading': 'Loading…',
        'token.title': 'Canvas API token',
        'token.hint': 'Used to read the canvas list (read-only), sent to the deployment as Authorization: Bearer. To get it, open the canvas site, press F12 for the Console, run the snippet below and copy the printed token.',
        'token.codeLabel': 'Console snippet',
        'token.copy': 'Copy',
        'token.copied': 'Copied',
        'token.copyFailed': 'Copy failed',
        'token.save': 'Save token',
        'token.clear': 'Clear token',
        'token.saved': 'Token saved',
        'token.present': 'Configured',
        'token.missing': 'Not configured',
        'form.baseUrl': 'Canvas deployment URL',
        'form.baseUrlHint': 'Defaults to {default}; point it at your own deployment.',
        'form.agentUrl': 'Local agent URL',
        'form.agentUrlHint': 'The official default is http://127.0.0.1:3210.',
        'form.embed': 'Embed the connect credentials when opening',
        'form.embedHint': 'Writes the agent URL and token into the opened canvas address hash so the page connects on open. When off, the handshake is manual inside the canvas page.',
        'form.save': 'Save',
        'form.reset': 'Reset addresses',
        'form.saved': 'Saved',
        'form.saving': 'Saving…',
        'form.error': 'Save failed: {message}',
        'settings.title': 'Infinite Canvas',
        'settings.intro': 'Configure the deployment and how the local Canvas Agent is reached. The canvas opens in a browser tab; the panel does not embed it and no canvas id has to be typed — whichever canvas you open from the list is remembered.',
        'status.heading': 'Connection',
        'status.agent': 'Local agent',
        'status.canvas': 'Canvas link',
        'status.openUrl': 'Opens',
        'status.token': 'Connect token',
        'status.tools': 'Canvas tools',
        'status.yes': 'Ready',
        'status.no': 'Not ready',
        'status.tokenFile': 'Read from {source}',
        'status.noToken': 'Not found — start the local Canvas Agent first',
        'status.hint': 'Run npx -y @tigerowo/canvas-agent@latest on this machine, then press Open canvas above to open the credentialed canvas page in your browser and pick a canvas.',
        'status.mcp': 'MCP tool names: mcp__{server}__<tool>',
        'status.settingsPath': 'Settings file: {path}',
        'action.startAgent': 'Start agent',
        'action.stopAgent': 'Stop agent',
        'status.starting': 'Starting the local agent…',
        'status.external': 'Agent already running externally',
        'status.log': 'Recent log',
        'status.phase': 'Supervisor',
        'form.autoStart': 'Keep the local agent running with Harness',
        'form.autoStartHint': 'When on, the plugin starts npx -y @tigerowo/canvas-agent@latest with Harness and restarts it after a crash. When off, it runs only when you press Start agent.',
        'phase.idle': 'Not started',
        'phase.starting': 'Starting',
        'phase.running': 'Managed by Harness',
        'phase.external': 'Running externally',
        'phase.stopping': 'Stopping',
        'phase.stopped': 'Stopped',
        'phase.exited': 'Exited',
        'phase.error': 'Failed to start',
      },
    }

    const css = `
.dsh-ic-page{box-sizing:border-box;height:100%;min-height:0;display:flex;flex-direction:column;gap:12px;padding:calc(28px + var(--dsh-frame-top-clearance,0px)) 16px 16px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px}
.dsh-ic-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-height:26px}
.dsh-ic-title{margin:0;font-size:15px;font-weight:600;line-height:1.3}
.dsh-ic-muted{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.dsh-ic-spacer{flex:1 1 auto}
.dsh-ic-button{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:28px;padding:0 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;cursor:pointer;text-decoration:none;white-space:nowrap}
.dsh-ic-button:not(.dsh-ic-button--primary):hover{background:var(--dsw-alias-bg-layer-2)}
.dsh-ic-button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dsh-ic-button[disabled]{opacity:.55;cursor:default}
/* Fill and label come as a pair so light and dark themes both stay readable. */
.dsh-ic-button--primary{background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));border-color:transparent;color:var(--dsw-alias-label-primary-foreground,#fff)}
.dsh-ic-button--primary:hover:not([disabled]){background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary)));filter:none}
.dsh-ic-button--primary[disabled]{color:var(--dsw-alias-label-primary-foreground,#fff);opacity:.55}
.dsh-ic-hero-url{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;line-height:1.5;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.dsh-ic-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dsh-ic-project{display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
.dsh-ic-code-wrap{display:flex;flex-direction:column;gap:6px}
.dsh-ic-code-head{display:flex;align-items:center;gap:8px}
.dsh-ic-code-block{margin:0;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere;tab-size:2}
.dsh-ic-code-btn{height:24px;padding:0 9px;font-size:12px}
.dsh-ic-field{display:flex;flex-direction:column;gap:5px}
.dsh-ic-label{font-size:12.5px;font-weight:500;color:var(--dsw-alias-label-primary)}
.dsh-ic-input{box-sizing:border-box;width:100%;height:34px;padding:0 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}
.dsh-ic-input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dsh-ic-row{display:flex;align-items:center;gap:10px;justify-content:flex-end}
.dsh-ic-check{display:flex;align-items:flex-start;gap:8px;font-size:12.5px;line-height:1.5}
.dsh-ic-check input{margin:2px 0 0;accent-color:var(--dsw-alias-brand-primary)}
.dsh-ic-error{color:var(--dsw-alias-state-error-primary);font-size:12px}
.dsh-ic-ok{color:var(--dsw-alias-state-success-primary);font-size:12px}
.dsh-ic-section{display:flex;flex-direction:column;gap:12px;max-width:640px;padding-bottom:24px}
.dsh-ic-list{display:flex;flex-direction:column;gap:6px}
.dsh-ic-list-row{display:flex;gap:10px;align-items:baseline;font-size:12.5px;line-height:1.5}
.dsh-ic-key{flex:0 0 108px;color:var(--dsw-alias-label-secondary)}
.dsh-ic-value{min-width:0;overflow-wrap:anywhere;color:var(--dsw-alias-label-primary)}
.dsh-ic-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
.dsh-ic-divider{height:1px;background:var(--dsw-alias-border-l1)}
.dsh-ic-log{margin:0;max-height:150px;overflow:auto;padding:8px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}
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
    const saveCanvasToken = (token) =>
      callApi('canvas-token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
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

    /** Copy-to-clipboard with a legacy fallback, since the GUI may run in a plain frame. */
    async function copyText(text) {
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined) {
          await navigator.clipboard.writeText(text)
          return true
        }
      } catch {
        // Fall through to the textarea path.
      }
      try {
        const area = document.createElement('textarea')
        area.value = text
        area.setAttribute('readonly', '')
        area.style.position = 'fixed'
        area.style.top = '-1000px'
        area.style.opacity = '0'
        document.body.appendChild(area)
        area.select()
        const copied = document.execCommand('copy')
        document.body.removeChild(area)
        return copied === true
      } catch {
        return false
      }
    }

    /** A read-only snippet with its own copy action. */
    function CodeBlock({ t, code }) {
      const [state, setState] = useState('idle')
      const copy = async () => {
        const copied = await copyText(code)
        setState(copied ? 'copied' : 'failed')
        setTimeout(() => setState('idle'), copied ? 1600 : 2600)
      }
      return h(
        'div',
        { className: 'dsh-ic-code-wrap' },
        h(
          'div',
          { className: 'dsh-ic-code-head' },
          h('span', { className: 'dsh-ic-label' }, t('token.codeLabel')),
          h('span', { className: 'dsh-ic-spacer' }),
          h(
            'button',
            { type: 'button', className: 'dsh-ic-button dsh-ic-code-btn', onClick: () => void copy() },
            state === 'copied' ? t('token.copied') : state === 'failed' ? t('token.copyFailed') : t('token.copy'),
          ),
        ),
        h('pre', { className: 'dsh-ic-code-block' }, code),
      )
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

    /** One form for the panel and the Settings section; both write the same file. */
    function SettingsForm({ t, state, onSaved }) {
      const uid = useId()
      const baseId = `${uid}-base`
      const agentId = `${uid}-agent`
      const [baseUrl, setBaseUrl] = useState(state === null ? '' : state.canvasBaseUrl)
      const [agentUrl, setAgentUrl] = useState(state === null ? '' : state.agentUrl)
      const [embed, setEmbed] = useState(state === null ? true : state.embedCredentials !== false)
      const [autoStart, setAutoStart] = useState(state === null ? true : state.autoStart !== false)
      const [dirty, setDirty] = useState(false)
      const [busy, setBusy] = useState(false)
      const [message, setMessage] = useState('')
      const [failure, setFailure] = useState('')
      const [apiToken, setApiToken] = useState('')
      const [tokenBusy, setTokenBusy] = useState(false)
      const [tokenMessage, setTokenMessage] = useState('')
      const [tokenFailure, setTokenFailure] = useState('')

      useEffect(() => {
        if (state === null || dirty) return
        setBaseUrl(state.canvasBaseUrl)
        setAgentUrl(state.agentUrl)
        setEmbed(state.embedCredentials !== false)
        setAutoStart(state.autoStart !== false)
      }, [state, dirty])

      const submit = async (patch) => {
        setBusy(true)
        setFailure('')
        setMessage('')
        try {
          const next = await saveSettings(patch)
          setDirty(false)
          setMessage(t('form.saved'))
          if (typeof onSaved === 'function') onSaved(next)
        } catch (error) {
          setFailure(t('form.error', { message: error instanceof Error ? error.message : String(error) }))
        } finally {
          setBusy(false)
        }
      }

      const submitToken = async (value) => {
        setTokenBusy(true)
        setTokenFailure('')
        setTokenMessage('')
        try {
          const next = await saveCanvasToken(value)
          setApiToken('')
          setTokenMessage(t('token.saved'))
          if (typeof onSaved === 'function') onSaved(next)
        } catch (error) {
          setTokenFailure(error instanceof Error ? error.message : String(error))
        } finally {
          setTokenBusy(false)
        }
      }

      const defaults = state === null ? { canvasBaseUrl: '', agentUrl: '' } : state.defaults

      return h(
        'div',
        { className: 'dsh-ic-field', style: { gap: '14px' } },
        h(
          Field,
          { label: t('form.baseUrl'), hint: t('form.baseUrlHint', { default: defaults.canvasBaseUrl }), htmlFor: baseId },
          h('input', {
            id: baseId,
            className: 'dsh-ic-input',
            type: 'url',
            spellCheck: false,
            value: baseUrl,
            placeholder: defaults.canvasBaseUrl,
            onChange: (event) => {
              setDirty(true)
              setBaseUrl(event.target.value)
            },
          }),
        ),
        h(
          Field,
          { label: t('form.agentUrl'), hint: t('form.agentUrlHint'), htmlFor: agentId },
          h('input', {
            id: agentId,
            className: 'dsh-ic-input',
            type: 'url',
            spellCheck: false,
            value: agentUrl,
            placeholder: defaults.agentUrl,
            onChange: (event) => {
              setDirty(true)
              setAgentUrl(event.target.value)
            },
          }),
        ),
        h(
          'label',
          { className: 'dsh-ic-check' },
          h('input', {
            type: 'checkbox',
            checked: autoStart,
            onChange: (event) => {
              setDirty(true)
              setAutoStart(event.target.checked)
            },
          }),
          h('span', null, t('form.autoStart'), h('br'), h('span', { className: 'dsh-ic-muted' }, t('form.autoStartHint'))),
        ),
        h(
          'label',
          { className: 'dsh-ic-check' },
          h('input', {
            type: 'checkbox',
            checked: embed,
            onChange: (event) => {
              setDirty(true)
              setEmbed(event.target.checked)
            },
          }),
          h('span', null, t('form.embed'), h('br'), h('span', { className: 'dsh-ic-muted' }, t('form.embedHint'))),
        ),
        h(
          'div',
          { className: 'dsh-ic-field', style: { gap: '8px' } },
          h(
            'span',
            { className: 'dsh-ic-label' },
            t('token.title'),
            ' · ',
            h(
              'span',
              { className: 'dsh-ic-muted' },
              state !== null && state.apiTokenAvailable === true ? t('token.present') : t('token.missing'),
            ),
          ),
          h(
            'div',
            { className: 'dsh-ic-actions' },
            h('input', {
              className: 'dsh-ic-input',
              style: { flex: '1 1 220px' },
              type: 'password',
              spellCheck: false,
              autoComplete: 'off',
              value: apiToken,
              placeholder: state !== null && state.apiTokenAvailable === true ? '••••••' : t('token.missing'),
              onChange: (event) => setApiToken(event.target.value),
            }),
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-ic-button',
                disabled: tokenBusy || apiToken.trim() === '',
                onClick: () => void submitToken(apiToken.trim()),
              },
              t('token.save'),
            ),
            h(
              'button',
              { type: 'button', className: 'dsh-ic-button', disabled: tokenBusy, onClick: () => void submitToken('') },
              t('token.clear'),
            ),
          ),
          h('p', { className: 'dsh-ic-muted' }, t('token.hint')),
          h(CodeBlock, { t, code: TOKEN_SNIPPET }),
          tokenFailure === '' ? null : h('p', { className: 'dsh-ic-error' }, tokenFailure),
          tokenMessage === '' ? null : h('p', { className: 'dsh-ic-ok' }, tokenMessage),
        ),
        failure === '' ? null : h('p', { className: 'dsh-ic-error' }, failure),
        message === '' ? null : h('p', { className: 'dsh-ic-ok' }, message),
        h(
          'div',
          { className: 'dsh-ic-row' },
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-ic-button',
              disabled: busy,
              onClick: () => {
                setDirty(true)
                void submit({
                  canvasBaseUrl: defaults.canvasBaseUrl,
                  agentUrl: defaults.agentUrl,
                  embedCredentials: true,
                })
              },
            },
            t('form.reset'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-ic-button dsh-ic-button--primary',
              disabled: busy,
              onClick: () => void submit({ canvasBaseUrl: baseUrl, agentUrl, embedCredentials: embed, autoStart }),
            },
            busy ? t('form.saving') : t('form.save'),
          ),
        ),
      )
    }

    /** Connection facts shared by the panel and the settings page. */
    function StatusList({ t, state, agent }) {
      if (state === null) return null
      const readyOr = (ready) => (ready === true ? t('status.yes') : t('status.no'))
      const tokenText =
        state.tokenAvailable !== true
          ? t('status.noToken')
          : t('status.tokenFile', { source: state.tokenSource === 'env' ? 'CANVAS_AGENT_TOKEN' : state.tokenFile })
      const toolNames =
        agent !== null && Array.isArray(agent.tools) ? agent.tools.filter((toolName) => typeof toolName === 'string') : []
      const rows = [
        [t('status.agent'), readyOr(agent !== null && agent.running === true)],
        [t('status.phase'), agent === null ? t('status.no') : t(`phase.${agent.phase === undefined ? 'idle' : agent.phase}`)],
        [t('status.canvas'), readyOr(agent !== null && agent.connected === true)],
        [t('status.openUrl'), state.canvasUrl],
        [t('status.token'), tokenText],
        [t('status.tools'), toolNames.length > 0 ? toolNames.join(', ') : t('status.no')],
        ['MCP', t('status.mcp', { server: state.mcpServerName })],
      ]
      return h(
        'div',
        { className: 'dsh-ic-list' },
        rows.map(([key, value], index) =>
          h(
            'div',
            { className: 'dsh-ic-list-row', key: `${index}` },
            h('span', { className: 'dsh-ic-key' }, key),
            h('span', { className: 'dsh-ic-value' }, value),
          ),
        ),
      )
    }

    /**
     * Token check, nothing else: the canvas-agent MCP tool set has no
     * canvas-management tools, so a project listing is the cheapest way to
     * prove the stored token can reach the deployment API. Creating and
     * switching canvases happens inside the canvas page itself, in the same
     * browser tab, so no canvas id is kept here.
     */
    function TokenCheck({ t, state }) {
      const [projects, setProjects] = useState(null)
      const [failure, setFailure] = useState('')

      // Depend on the flag, not the whole state object: the panel re-reads state
      // every few seconds and must not re-hit the deployment API each time.
      const available = state !== null && state.apiTokenAvailable === true

      const load = useCallback(async () => {
        if (!available) {
          setProjects(null)
          return
        }
        try {
          const payload = await readProjects()
          setProjects(Array.isArray(payload === undefined ? undefined : payload.projects) ? payload.projects : [])
          setFailure('')
        } catch (error) {
          setProjects([])
          setFailure(error instanceof Error ? error.message : String(error))
        }
      }, [available])

      useEffect(() => {
        void load()
      }, [load])

      if (state === null) return null
      if (state.apiTokenAvailable !== true) {
        return h('p', { className: 'dsh-ic-muted' }, t('check.noToken'))
      }

      const summary =
        projects === null
          ? h('p', { className: 'dsh-ic-muted' }, t('projects.loading'))
          : projects.length === 0
            ? h('p', { className: 'dsh-ic-muted' }, t('check.empty'))
            : h(
                'div',
                null,
                h('p', { className: 'dsh-ic-ok' }, t('check.ok', { count: projects.length })),
                h(
                'div',
                { className: 'dsh-ic-list' },
                projects.map((project) =>
                  h(
                    'div',
                    { className: 'dsh-ic-project', key: project.id },
                    h(
                      'div',
                      { style: { minWidth: 0 } },
                      h('div', { className: 'dsh-ic-label' }, project.title),
                      h(
                        'div',
                        { className: 'dsh-ic-hero-url' },
                        `${project.id} · ${t('check.nodes', { count: project.nodeCount })}`,
                      ),
                    ),
                  ),
                ),
                ),
              )

      return h(
        'div',
        { className: 'dsh-ic-field' },
        h(
          'div',
          { className: 'dsh-ic-bar' },
          h('h3', { className: 'dsh-ic-title', style: { fontSize: '13px' } }, t('check.title')),
          h('span', { className: 'dsh-ic-spacer' }),
          h('button', { type: 'button', className: 'dsh-ic-button', onClick: () => void load() }, t('check.refresh')),
        ),
        h('p', { className: 'dsh-ic-muted' }, t('check.hint')),
        summary,
        failure === '' ? null : h('p', { className: 'dsh-ic-error' }, failure),
      )
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

    /**
     * The only seat this bundle registers: Infinite Canvas settings. Everything
     * the old sidebar panel did — connection state, starting the agent, opening
     * the canvas — lives here, because the automatic tab switch runs as a
     * background effect rather than as UI.
     */
    function SettingsSection({ t }) {
      const { state, agent, link, error, refresh, act, setState } = useCanvas()
      const openUrl = openLinkOf(link, state)
      const pending =
        state !== null && state.pending !== null && typeof state.pending === 'object' && state.pending !== undefined
          ? state.pending
          : null
      const pendingId = pending !== null && typeof pending.canvasId === 'string' ? pending.canvasId : ''
      const pendingUrl = pendingId === '' ? '' : withCanvasId(openUrl, pendingId)

      return h(
        'div',
        { className: 'dsh-ic-page', style: { padding: '0', background: 'transparent' } },
        h(Styles, null),
        h(
          'div',
          { className: 'dsh-ic-section' },
          h('h2', { className: 'dsh-ic-title' }, t('settings.title')),
          h('p', { className: 'dsh-ic-muted' }, t('settings.intro')),
          h(
            'div',
            { className: 'dsh-ic-actions' },
            openUrl === ''
              ? null
              : h(CanvasLink, { className: 'dsh-ic-button dsh-ic-button--primary', href: openUrl }, t('open.button')),
            h('button', { type: 'button', className: 'dsh-ic-button', onClick: () => void refresh() }, t('action.refresh')),
          ),
          h('p', { className: 'dsh-ic-muted' }, t('open.keepOpen')),
          pendingUrl === ''
            ? null
            : h(
                'div',
                { className: 'dsh-ic-actions' },
                h('span', { className: 'dsh-ic-muted' }, t('panel.pending', { title: pending.title !== '' ? pending.title : pendingId })),
                h(CanvasLink, { className: 'dsh-ic-button dsh-ic-button--primary', href: pendingUrl }, t('open.button')),
                pending.blocked === true ? h('span', { className: 'dsh-ic-muted' }, t('panel.blocked')) : null,
              ),
          h(SettingsForm, {
            t,
            state,
            onSaved: (next) => {
              setState(next)
              void refresh()
            },
          }),
          h('div', { className: 'dsh-ic-divider' }),
          h('h3', { className: 'dsh-ic-title', style: { fontSize: '13px' } }, t('status.heading')),
          h(StatusList, { t, state, agent }),
          h(
            'div',
            { className: 'dsh-ic-row', style: { justifyContent: 'flex-start' } },
            agent !== null && agent.phase === 'starting'
              ? h('button', { type: 'button', className: 'dsh-ic-button', disabled: true }, t('status.starting'))
              : agent !== null && agent.managed === true && agent.running === true
                ? h('button', { type: 'button', className: 'dsh-ic-button', onClick: () => void act('stop') }, t('action.stopAgent'))
                : agent !== null && agent.phase === 'external'
                  ? h('span', { className: 'dsh-ic-muted' }, t('status.external'))
                  : h('button', { type: 'button', className: 'dsh-ic-button', onClick: () => void act('start') }, t('action.startAgent')),
          ),
          agent !== null && typeof agent.error === 'string' && agent.connected !== true
            ? h('p', { className: 'dsh-ic-muted dsh-ic-code' }, agent.error)
            : null,
          error === '' ? null : h('p', { className: 'dsh-ic-error' }, error),
          agent !== null && Array.isArray(agent.log) && agent.log.length > 0
            ? h(
                'div',
                { className: 'dsh-ic-field' },
                h('span', { className: 'dsh-ic-label' }, t('status.log')),
                h('pre', { className: 'dsh-ic-log' }, agent.log.join('\n')),
              )
            : null,
          h('p', { className: 'dsh-ic-muted' }, t('status.hint')),
          h('div', { className: 'dsh-ic-divider' }),
          h(TokenCheck, { t, state }),
          state === null ? null : h('p', { className: 'dsh-ic-muted dsh-ic-code' }, t('status.settingsPath', { path: state.settingsPath })),
        ),
      )
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
              const pending =
                state !== null && state !== undefined && typeof state.pending === 'object' && state.pending !== null
                  ? state.pending
                  : null
              const canvasId = pending !== null && typeof pending.canvasId === 'string' ? pending.canvasId : ''
              if (canvasId !== '' && canvasId !== lastHandled) {
                lastHandled = canvasId
                const payload = await callApi('link', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ canvasId }),
                })
                const url = payload !== undefined && typeof payload.url === 'string' ? payload.url : ''
                if (url !== '' && alive) {
                  const opened = window.open(url, CANVAS_TAB)
                  if (opened === null) {
                    // The browser refused: record it so the model can hand the
                    // person a link instead of asking them to open settings.
                    try {
                      await callApi('target', {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ canvasId, title: pending.title, blocked: true }),
                      })
                    } catch {
                      // Nothing else to do; the next poll retries anyway.
                    }
                    return
                  }
                  try {
                    opened.opener = null
                  } catch {
                    // Best effort.
                  }
                  try {
                    await callApi('target', {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({ canvasId: '' }),
                    })
                  } catch {
                    // The guard above already prevents a second navigation.
                  }
                }
              }
            } catch {
              // A closed server or a blocked popup just means "try again later".
            }
            if (alive) timer = setTimeout(() => void tick(), 5000)
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
