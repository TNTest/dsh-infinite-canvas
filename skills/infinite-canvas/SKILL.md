---
name: infinite-canvas
description: Use Infinite Canvas in Harness to list, create or select a canvas with the configured user API Key, then edit its live nodes with the canvas MCP tools. Use for canvas editing, storyboards, visual layouts and connection troubleshooting.
---

# Infinite Canvas

## Choose the canvas before editing

1. Call `infinite_canvas_status`. The deployment API Key and the local Agent connection are separate: the Key lists/creates saved canvases; the Agent edits the canvas currently open in the browser. If already connected, read `mcp__infinite-canvas__get_canvas_summary` first. If its project ID is the intended target, continue editing without calling `open` or navigating the browser again.
2. Use `infinite_canvas_projects` with `action: list` to resolve a named canvas by title and ID. If titles are ambiguous, ask the user which one. Use `action: open` with `canvasId` to switch to an existing canvas; use `action: create` with `title` only when the user requested a new canvas.
3. After opening or creating, check `infinite_canvas_status`. If `pendingBlocked` is true, give the user the returned `openLink` and wait for them to open it. Never construct a URL containing credentials. If the canvas is not connected yet, explain the connection step instead of repeating create.
4. Once connected, call `mcp__infinite-canvas__get_canvas_summary` and verify `project.id` matches the intended canvas. Do not edit a previously connected canvas while a switch is pending. Keep one connected browser tab.

## Work on the live canvas

- Discover the available `mcp__infinite-canvas__*` tools and use their current schemas. Read the canvas summary and relevant nodes before editing; preserve unrelated nodes and connections.
- Use the live canvas tools for node/layout changes. The deployment API Key does not log the browser into the site or replace the local Agent handshake. Do not claim a canvas is editable solely because its API listing succeeds.
- Avoid paid image/video/audio generation unless the user's task authorizes that generation. Do not automatically retry a generation that may already have run.
- After edits, read the relevant nodes or summary again. Report what was created or changed and any unverified persistence or generation state.

## Configuration and failures

- Users configure a dedicated `ic_` Key under Settings → Infinite Canvas. Listing needs `read`; creation needs `read + write`. The model never needs the Key itself.
- Never request browser localStorage/session tokens, read credential files, print keys, put keys in links, or substitute a model-provider API key.
- On 401, ask the user to replace the invalid/expired/revoked Key in settings. On 403, report missing scopes or exhausted quota. On 429, follow the suggested wait; do not loop. Other failures are not proof that the Key expired.
- If the local Agent is unavailable, use the settings page's Start agent control. If multiple canvases are connected, ask the user to keep only the intended one; do not disconnect unrelated sessions automatically.
- If status lists canvas tools but they are missing from the model's callable tools, the MCP bridge is not ready. Report that bridge problem; reopening or recreating a canvas does not fix it. Check that both plugin components are running and that a custom Agent port matches `CANVAS_AGENT_PORT` in the MCP row.
