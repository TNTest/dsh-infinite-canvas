---
name: infinite-canvas
description: Operate saved Infinite Canvas projects, nodes, connections, groups, layout and backend media tasks through API Key. Use for canvas creation, editing, storyboards and media-task management. Browser and local Agent are not required; the optional launcher serves the web app separately.
---

# Infinite Canvas backend workflow

1. Call `infinite_canvas_status` to check **backend** connectivity. A stopped web Agent is not an API failure. Never start an Agent, navigate a browser or request a browser session token to make backend tools work.
2. Use `infinite_canvas_projects` with `action: list` to resolve the intended canvas by title and ID; ask if names are ambiguous. Create only when the user requested a new canvas. All node and media calls require explicit `canvasId`; there is no implicit current tab or mouse selection.
3. Read with `infinite_canvas_nodes` (`summary`, `query`, `get`, `upstream`, `downstream`, `connected`). Results include `project.revision`; use the current value as `expectedRevision` for each write, then use the new revision returned by the write. Preserve unrelated content.
4. Node writes support `create_primary_script`, `create_text`, `create_media`, `update_text`, `rename`, `move`, `connect`, `disconnect`, `group`, `arrange` and `delete`. The primary script also needs `projectTitle`. `create_media` only prepares a node and never starts generation. `delete` removes graph references and handles group/batch membership, but retains files, task records and generation history. Deleting a whole canvas is a separate project action and requires the user's explicit intent.
5. On a version conflict, reread and assess the user's intended edit against the new content; do not blindly replay a stale edit. The backend has no atomic compare-and-swap: these checks reduce stale writes but cannot guarantee conflict-free concurrent browser/API editing. Ask users to save browser edits first and reload the web page after API edits. Do not claim a live page was updated.
6. Read the affected nodes again after edits and report their IDs and confirmed saved values. `open` only returns a plain optional viewing URL; never open it automatically.

## Backend media tasks

- Use `infinite_canvas_catalog` to discover public model/channel options and saved workflows or skills. The Key cannot read personal provider/storage credentials or browser-local configuration.
- Generate only when the user's task authorizes it. First prepare a media node with `create_media`; then call `infinite_canvas_media` with `submit`, its fresh `expectedRevision`, explicit `channelId`, and a `request` JSON object matching that backend provider's API contract (including `model`). Use `edit: true` only for supported image-edit JSON requests with explicit references. The tool does not infer browser-local providers, upload local files or translate arbitrary workflow/model payloads.
- `status` reads a task without changing the canvas. `sync` queries and writes its result/status to the node and requires a fresh revision. `stop` requests backend task cancellation; it is not deletion or a guaranteed refund.
- Submitted nodes cannot be submitted again. A submission timeout can mean a billable task already started: retain the returned task ID, query it, and never automatically retry. Create a new node only after the user deliberately requests another generation. Additional URLs remain available in the task response; the current sync writes the primary result rather than recreating the web app's batch-result UI.

## Independent web-Agent launcher

Settings retains start/stop, automatic startup and “Open web app with Agent” for the browser's local assistant. These are convenience controls, independent of the backend tools. They do not grant access to browser selection, unsaved edits or a local Codex session through the API.

## Credentials and errors

Users configure a dedicated `ic_` Key in Settings. Listing needs `read`; canvas edits need `read + write`; task submission needs `generate`; resource deletion needs `delete`. The model never needs the Key. Do not read credential files or include keys in messages, tool arguments, URLs or saved nodes. On 401 ask the user to replace the Key in settings; on 403 explain scopes/quota; on 429 wait as directed without looping. Other failures do not prove the Key expired.
