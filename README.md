# dsh-infinite-canvas

[English](README.md) | [简体中文](README.zh-CN.md)

Connect [Infinite Canvas](https://github.com/TNTest/infinite-canvas) to DeepSeek Harness with a user API Key, a compact settings page, and live canvas MCP tools.

## Quick start

1. Install this plugin bundle in Harness from `https://github.com/TNTest/dsh-infinite-canvas`.
2. Open **Settings → Infinite Canvas**. The default deployment is `https://infic.transiglobal.com`.
3. In the canvas site's **Account → API Key**, create a dedicated user key beginning with `ic_`. Grant `read` to list canvases and `read + write` to create them. Paste it into the plugin and choose **Verify & save**. No browser console or session token is needed.
4. Choose **Open canvas** or open an item in **My canvases**. Sign in to the canvas site separately if needed. Keep one connected canvas tab.
5. Ask the agent to work on a canvas. The bundled `infinite-canvas` skill guides selection, connection checks and live editing.

Node.js 22+ and `npx` are required. The plugin starts and supervises `npx -y @tigerowo/canvas-agent@latest`; its first start downloads dependencies and can take a while.

## What the plugin does

- Configures the deployment URL and user API Key, and lists account canvases with direct open actions.
- Exposes `infinite_canvas_projects` with `list`, `create` and `open` actions. Creating requires `read + write`; opening selects an existing canvas by ID.
- Exposes `infinite_canvas_status` for the local Agent, live canvas connection and browser handoff state.
- Bridges the official canvas-agent MCP tools as `mcp__infinite-canvas__<tool>`. Live node edits require a canvas page connected to the local Agent.
- Registers the bundled `infinite-canvas` skill automatically while the plugin is enabled; no separate skill installation is needed.

The API Key authorizes backend requests. It does not sign the browser into the canvas site or replace the local Agent's connection token. The plugin reads that Agent token automatically and uses it only for the browser connection handshake; it never puts the user API Key in a browser link.

When an agent creates or opens a canvas, the plugin attempts to reuse the same named browser tab. If the browser blocks opening, the agent can give the user the `openLink` returned by `infinite_canvas_status`. Before editing, the skill requires checking `get_canvas_summary` against the intended canvas ID.

## Settings and credentials

Normal setup needs only the site URL and user API Key. **Advanced settings** contains the local Agent URL (default `http://127.0.0.1:3210`), automatic startup and automatic browser connection. Connection diagnostics are collapsed by default.

| Item | Location / configuration |
| --- | --- |
| UI settings | `$DSH_HOME/infinite-canvas/settings.json` |
| User API Key | `$DSH_HOME/infinite-canvas/canvas-api.json`, mode `0600`, bound to its verified deployment URL |
| Environment override | `CANVAS_API_KEY`, used only with the deployment URL from the plugin row config |
| Local Agent connection token | `~/.infinite-canvas/codex-agent.json`, written by canvas-agent |
| Redacted Agent log | `$DSH_HOME/infinite-canvas/agent.log` |
| Bundle rows / command defaults | `cordis.patch.yml` |

The Key is sent only in the `Authorization` header. Remote deployments require HTTPS; localhost HTTP is allowed for testing. Authenticated API requests do not follow redirects. Changing the deployment URL makes the previously saved Key unavailable until a Key is verified for the new URL. Old browser session tokens are not reused.

The Key stays out of state responses, model tool output and logs. A `401` indicates an invalid, expired or revoked Key; `403` indicates missing permissions or exhausted request quota; `429` means wait before retrying. Generation may consume the account's credits and should only run when requested.

If you change the local Agent port, also set `env.CANVAS_AGENT_PORT` on the `infinite-canvas-mcp` row in your Harness profile overrides, then restart Harness. Both sides must use the same port. An isolated port is useful when other canvas sessions already use `3210`.

```yaml
- id: infinite-canvas
  config:
    agentUrl: http://127.0.0.1:3211
- id: infinite-canvas-mcp
  config:
    serverName: infinite-canvas
    transport: stdio
    command: npx
    args: ['-y', '@tigerowo/canvas-agent@latest', 'mcp']
    failOnStartupError: false
    env:
      CANVAS_AGENT_PORT: "3211"
```

The UI setting takes precedence over the row default; update it to the same address in Advanced settings.

## Limits

- Canvas API integration targets the API Key support in [TNTest/infinite-canvas](https://github.com/TNTest/infinite-canvas), using its `{ code, data, msg }` response format.
- Listing and creation work through the backend; live node tools still require the browser and local Agent. Multiple connected tabs can prevent the Agent from resolving its target.
- Canvas selection is not saved in plugin settings. The connected browser tab determines the current editing context.
- The plugin stops its managed Agent when unloaded. Force-quitting Harness may leave an Agent process running; the next start detects an existing service.

## Verification

```bash
node test/host.test.mjs
node test/client.test.mjs
npm pack --dry-run --ignore-scripts
```

Host tests cover API Key validation and deployment binding, permissions and rate-limit errors, same-origin guards, project operations, skill registration and Agent supervision. Client tests render the settings page and exercise configuration and single-tab handoff behaviour. They use test credentials and local fake services.
