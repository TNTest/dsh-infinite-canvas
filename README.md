# dsh-infinite-canvas

Brings [Infinite Canvas](https://github.com/tigerowo/infinite-canvas) into DeepSeek Harness:

- **设置页 / Settings only** — everything lives in Settings → 无限画布: the deployment URL, the
  local agent URL, auto start, the connect token, live connection state, the supervisor log, a
  one-click 「打开画布」, and the account's canvas list (also the token check). There is no
  workspace panel: the canvas itself is a page in your browser.
- **自动启动本地 Agent** — the Host half starts and supervises
  `npx -y @tigerowo/canvas-agent@latest` itself: no terminal, no second install. It waits for
  the service to listen, restarts it after a crash (up to 3 consecutive attempts), and stops it
  when the plugin unloads. `autoStart: false` in the row config turns that off.
- **官方 MCP 工具** — the official `@tigerowo/canvas-agent mcp` bridge over stdio, so the
  model calls canvas tools as `mcp__infinite-canvas__<tool>`.
- **连接状态工具** — `infinite_canvas_status` tells the model the canvas URL, whether the
  agent is up, whether a canvas is connected, and what to fix when it is not.
- **画布工具（列表 / 新建）** — `infinite_canvas_projects` lists the deployment's canvases and,
  when the person asks for one, creates a new canvas; the client half then switches the single
  canvas tab to it. No canvas id is ever stored.

## What it needs on this machine

1. Node.js 22+ (the MCP child and the agent both run through `npx`).
2. Nothing else. On activation the plugin starts the agent, which prints its address and
   `Connect token` and saves the token to `~/.infinite-canvas/codex-agent.json`. Nothing in
   this bundle stores that token; the settings page only asks for it to hand it to the canvas page.
3. A canvas page connected to that agent — 「打开画布」 in Settings opens it for you in a browser
   tab: the deployment's canvas list with `agentUrl` and `agentToken` appended as a hash, the
   same handshake as `canvas-agent open <url> <browser>`. Nothing is embedded: a cross-site
   iframe cannot carry the site's login session, so an embedded canvas stays logged out and
   never reaches the agent.

The first start downloads `@tigerowo/canvas-agent` (and `@openai/codex`), which can take a
while; Settings shows 「正在启动本地 Agent…」 until the service answers.

## Canvases: list, create, and hand over to the browser

The `canvas-agent` MCP tool set has no canvas-management tools, so this bundle uses the
deployment's REST API. Settings store **no** canvas id at all.

| Route | Does |
| --- | --- |
| `GET /infinite-canvas/projects` | lists the account's canvases (`GET /api/v1/canvas/projects`) |
| `POST /infinite-canvas/projects` | creates an empty canvas with the Web app's own project shape |
| `POST /infinite-canvas/target` | sets (or with `{canvasId: ''}` clears) the canvas the client should switch to; `blocked: true` records that the browser refused |
| `GET /infinite-canvas/open?canvas=<id>` | 302 to the credentialed canvas page — safe to paste into chat |
| `POST /infinite-canvas/canvas-token` | verifies a token by listing, then stores it (or clears it) |
| `POST /infinite-canvas/link` | the credentialed browser URL; optional `{canvasId}` targets one canvas |

**How a created canvas reaches the browser without a second tab.** Creating a canvas leaves a
`pending` target in memory and `GET /state` reports it. The client half polls, then calls
`window.open(credentialedUrl, 'dsh-infinite-canvas')`. Navigating an *already open* named window
needs no user gesture, so the single canvas tab is simply pointed at the new canvas — the agent
still sees exactly one connected canvas. The target is memory-only, never written to settings.
If no canvas tab exists yet the browser blocks that call: the client reports `blocked: true` back through
`POST /infinite-canvas/target`, `infinite_canvas_status` then exposes `pendingBlocked` and an `openLink`,
and the model can paste that link into the chat — it points at `GET /infinite-canvas/open?canvas=<id>`,
which 302-redirects to the credentialed canvas page, so the token stays in the redirect hash instead of the
message. One click opens the canvas; nothing has to be configured by hand. (Both behaviours were verified with CDP against a real Chrome.)

The deployment authenticates with `Authorization: Bearer <token>` — the signed-in user's own
token, stored in `$DSH_HOME/infinite-canvas/canvas-api.json` (mode `0600`, never returned by any
route). Get it from the canvas site with the snippet the settings form shows and can copy:

```js
Object.entries(localStorage).forEach(([key, value]) => {
  try {
    const { state = {} } = JSON.parse(value)
    if (state.token) console.log(state.token)
  } catch {}
})
```

Model-facing side: `infinite_canvas_projects` with `action: list | create`. List first when the
user names a canvas (match title or id); create only when the user asked for a new one.

## Defaults and where they live

| Value | Default | Change it |
| --- | --- | --- |
| Canvas deployment | `https://infic.transiglobal.com` | Settings → 无限画布, or `canvasBaseUrl` in the row config |
| Canvas to open | always the deployment canvas list `/canvas` | nothing to set — no canvas id is stored |
| Local agent | `http://127.0.0.1:3210` | Settings → 无限画布, or `agentUrl` |
| Put the agent credentials in the opened link | on | Settings → 无限画布, or `embedCredentials` |
| Start the agent with Harness | on | Settings → 无限画布, or `autoStart` |
| Agent command / arguments | `npx -y @tigerowo/canvas-agent@latest` | `agentCommand`, `agentArgs` in the row config |
| MCP server namespace | `infinite-canvas` | `cordis.patch.yml` (`serverName`) |
| Multi-canvas client id | unset | `env.CANVAS_AGENT_CLIENT_ID` in `cordis.patch.yml` |

UI edits are stored in `$DSH_HOME/infinite-canvas/settings.json` and take effect without a
plugin reload. The row config in `cordis.patch.yml` stays the default layer, so a user patch
layer survives upgrades. The agent's own console output is kept at
`$DSH_HOME/infinite-canvas/agent.log` with anything token-shaped replaced by `<token>`.

## Rows

```yaml
- id: infinite-canvas            # Host half of this package (+ autostart supervisor)
- id: infinite-canvas-mcp        # '@deepseek-ai/dsh-mcp-client', stdio -> npx ... mcp
```

## Behaviour of the supervisor

| Phase | Meaning |
| --- | --- |
| `starting` | a child was spawned, waiting for it to answer `GET /config` |
| `running` | our child answers; 「停止 Agent」 is offered |
| `external` | something else already listens on the agent URL, so nothing is spawned |
| `stopped` | stopped from Settings; the watchdog leaves it alone until you start it again |
| `exited` / `error` | the child died or never answered; the watchdog retries (max 3) |

## Testing

```bash
node test/host.test.mjs      # Host half: routes, guards, supervisor, deployment API
node test/client.test.mjs    # Client half: renders the settings seat, drives the tab follower
```

The host test runs the Host half against a fake Cordis context, `test/fake-agent.mjs`, and a
local fake of the deployment API: settings round trip, origin guards, connect-token handling,
log redaction, a real spawn → ready → stop cycle, and the canvas API (token verification,
project list, project create, the pending target, per-canvas links).

The client test needs no browser: a ~100-line hook runtime renders the whole settings tree
against a stubbed `fetch`, then drives the background tab follower — so a missing helper or a
throwing component fails the build instead of leaving the Settings page blank.

## Limits

- The canvas is a third-party Web application, opened in a normal browser tab; it keeps its
  own theme and controls, and it owns its own login session. The settings page only shows state.
- Every open action targets one named tab (`dsh-infinite-canvas`), so reopening navigates that
  same tab. The agent serves exactly one connected canvas, and a second tab makes
  `findSession` fail with 「请只连接一个画布」 — which is why switching happens inside the
  canvas page rather than by opening more tabs.
- Settings store no canvas id at all. 「打开画布」 always opens the deployment list; the person
  picks or creates a canvas there, and the canvas page keeps that choice in its own state,
  inside the same tab. The live context is whatever canvas that tab connects, readable with
  the `get_canvas_summary` MCP tool (`project.id`).
- `infinite_canvas_projects` resolves a canvas the person names: list, match title or id, then
  work on that canvas. `action: create` makes a new one and the client half switches its single tab to
  it. Which canvas is live remains the browser tab's business, not a stored setting.
- Canvas tools only exist while a canvas page is connected; the MCP bridge re-lists them when
  a canvas connects, so the tool list grows without a restart.
- A force-quit of Harness can leave the child running (a normal unload or plugin disable stops
  it). If `GET /config` still answers on the agent URL, the plugin treats it as `external`
  instead of spawning a second one.
- The canvas API token is a user credential: it is kept locally at mode `0600` and only ever
  sent to the deployment's own origin, never to the agent or a model.
- The plugin's API routes live under `/infinite-canvas` on the Harness Web server. They are
  same-origin guarded and never include the token in a readable cross-origin response; the
  token is only released to a same-origin `POST /infinite-canvas/token` or embedded in the
  link returned by `POST /infinite-canvas/link`.
