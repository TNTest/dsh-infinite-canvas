# dsh-infinite-canvas

[English](README.md) | [简体中文](README.zh-CN.md)

Operate saved [Infinite Canvas](https://github.com/TNTest/infinite-canvas) projects directly from DeepSeek Harness through a user API Key. An independent optional launcher starts the local Agent for the canvas web app.

## Quick start

1. Install the plugin bundle from `https://github.com/TNTest/dsh-infinite-canvas`.
2. Open **Settings → Infinite Canvas**. The default deployment is `https://infic.transiglobal.com`.
3. Create a dedicated `ic_` user Key in the canvas site's **Account → API Key**, paste it into the plugin, then choose **Verify & save**. Reading needs `read`; canvas edits need `read + write`; generation needs `generate`; deleting resources needs `delete`.
4. Ask Harness to list, create or edit a canvas. Backend tools work with the browser closed and the local Agent stopped. The bundled `infinite-canvas` skill is registered automatically.
5. **View canvases** is optional. If the page is already open, save its edits before API operations and reload it afterwards to see saved changes.

No browser-console login token is needed. API authentication does not sign the browser into the website.

## Two independent paths

| Path | Purpose | Requirements |
| --- | --- | --- |
| Backend API tools | Saved canvases, nodes, connections, groups, layout and backend media tasks | Deployment URL and API Key |
| Optional web-Agent launcher | Start/stop the local Agent used by the assistant in the canvas web app | Node.js 22+, `npx`, and an open canvas page when using that assistant |

The launcher retains automatic startup, a configurable local address and **Open web app with Agent**. Its default command is `npx -y @tigerowo/canvas-agent@latest`; the first start may download dependencies. The Agent's connection token is read automatically and used only for an explicitly requested web handshake. It is independent of the user API Key.

Creating or editing a canvas never opens or switches browser tabs. The plugin no longer uses a stdio MCP bridge for backend editing. The old `infinite-canvas-mcp` row ships disabled for upgrades; disable any old profile override that explicitly enables it. The web Agent does not need that Harness MCP row.

## Agent tools

| Tool | Actions |
| --- | --- |
| `infinite_canvas_status` | Check backend connectivity independently from the optional launcher |
| `infinite_canvas_projects` | `list`, `create`, `rename`, `delete`; `open` only returns a plain viewing URL |
| `infinite_canvas_nodes` | `summary`, `query`, `get`, `upstream`, `downstream`, `connected`; `create_text`, `create_primary_script`, `create_media`, `update_text`, `rename`, `move`, `delete`, `connect`, `disconnect`, `group`, `arrange` |
| `infinite_canvas_catalog` | Public models/channels, saved workflows, personal/system skills and system skill files |
| `infinite_canvas_media` | `submit`, read-only `status`, `sync` result into a node, `stop` a backend task |

Every node/media call names a `canvasId`. Reads return `project.revision`; node edits, project rename/delete and media submit/sync require a fresh `expectedRevision`. Writes preserve unrelated project fields and read back the result. Writes from this plugin are serialized per canvas, and known stale revisions are rejected. **The current backend has no atomic compare-and-swap**, so simultaneous browser/API editing can still race; do not treat these checks as collaborative real-time synchronization.

Node deletion cleans graph edges, group/batch membership and stale chat media references, but retains actual files, backend tasks and generation history. Grouping does not support nested groups or batch nodes; individual batch movement and batch layout remain web-app functions. There is no API equivalent of a mouse selection, unsaved browser state, local Codex session or private browser model configuration.

## Backend media tasks

Prepare an image, video or audio node with `create_media`; this never starts generation. `submit` needs an explicit backend `channelId` and a `request` JSON object containing `model` and the provider's required parameters. The Key is never placed in that object. Image-edit JSON requests can use `edit: true` with explicitly supplied references.

`status` only reads the task; `sync` writes its current status and primary result URL/media metadata into the node. Additional result URLs remain in the task response; sync does not recreate the web app's batch-result UI. Workflows can be discovered, but workflow execution, multipart uploads, browser-local providers and arbitrary model-specific parameter translation are not implemented by this tool.

Generation requires the user's authorization and can consume credits. Submission IDs are saved before sending the request; submitted nodes cannot be submitted again. On an uncertain timeout, query the retained task ID rather than retrying. Stop requests are not deletion or guaranteed refunds. Permissions, provider payloads and availability still apply even when the canvas itself is editable.

## Credentials and local files

- UI settings: `$DSH_HOME/infinite-canvas/settings.json`.
- API Key: `$DSH_HOME/infinite-canvas/canvas-api.json`, mode `0600`, bound to its verified deployment URL. `CANVAS_API_KEY` can override it for the deployment in the plugin row configuration.
- Optional web-Agent token: `~/.infinite-canvas/codex-agent.json`; redacted launcher log: `$DSH_HOME/infinite-canvas/agent.log`.

The Key is sent only in the `Authorization` header, never in links or tool output. Remote deployments require HTTPS; localhost HTTP is allowed for testing. Authenticated requests do not follow redirects. Changing the deployment makes its old saved Key unavailable until a Key is verified for the new URL.

## Verification

```bash
node test/canvas.test.mjs
node test/host.test.mjs
node test/client.test.mjs
npm pack --dry-run --ignore-scripts
```

Tests cover graph edits and preservation, revision conflicts, group movement, media submission/recovery/sync with fake tasks, HTTP credential isolation, backend edits with the web Agent stopped, optional Agent start/stop and settings rendering without automatic browser navigation. Real paid generation needs separate authorized acceptance for the selected model/channel.
