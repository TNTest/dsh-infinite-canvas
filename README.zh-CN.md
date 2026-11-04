# dsh-infinite-canvas

[English](README.md) | [简体中文](README.zh-CN.md)

将 [Infinite Canvas](https://github.com/tigerowo/infinite-canvas) 接入 DeepSeek Harness：

- **集中在设置页** — 在「设置 → 无限画布」中管理画布站地址、本地 Agent 地址、自动启动、连接令牌、
  实时连接状态和进程日志；支持一键「打开画布」，以及查看账户画布列表、验证画布站令牌。
  插件不提供工作区面板，画布本身在浏览器页面中运行。
- **自动启动本地 Agent** — Host 端自动启动并监管 `npx -y @tigerowo/canvas-agent@latest`，
  无需打开终端或单独安装。插件会等待服务就绪，在进程崩溃后重启（最多连续重试 3 次），
  并在插件卸载时停止进程。在行配置中设置 `autoStart: false` 可关闭自动启动。
- **官方 MCP 工具** — 使用官方 `@tigerowo/canvas-agent mcp`，通过 stdio 桥接，
  模型以 `mcp__infinite-canvas__<tool>` 的名称调用画布工具。
- **连接状态工具** — `infinite_canvas_status` 向模型提供画布地址、Agent 是否运行、
  是否有画布连接，以及未连接时的处理建议。
- **画布工具（列表 / 新建）** — `infinite_canvas_projects` 列出画布站上的画布，
  并在用户要求时创建新画布；客户端随后将唯一的画布标签页切换到新画布。设置中不保存画布 ID。

## 本机环境要求

1. Node.js 22+（MCP 子进程和 Agent 均通过 `npx` 运行）。
2. 无需额外安装其他组件。插件激活时会启动 Agent；Agent 输出服务地址和 `Connect token`，
   并将令牌保存到 `~/.infinite-canvas/codex-agent.json`。插件包本身不保存该令牌；
   设置页读取令牌仅用于将其交给画布页面。
3. 需要一个已连接到该 Agent 的画布页面。在设置中点击「打开画布」，会在浏览器标签页中打开画布站列表，
   并在 URL 的 hash 中附加 `agentUrl` 和 `agentToken`，与 `canvas-agent open <url> <browser>`
   使用相同的连接握手方式。画布不内嵌到插件中：跨站 iframe 无法携带网站的登录会话，
   内嵌画布会保持未登录状态，无法连接到 Agent。

首次启动需要下载 `@tigerowo/canvas-agent`（以及 `@openai/codex`），可能需要一些时间；
在服务响应前，设置页会显示「正在启动本地 Agent…」。

## 画布：列出、新建并交给浏览器

`canvas-agent` 的 MCP 工具集不包含画布管理工具，因此插件使用画布站的 REST API。
设置中**不保存任何画布 ID**。

| 路由 | 功能 |
| --- | --- |
| `GET /infinite-canvas/projects` | 列出账户的画布（调用 `GET /api/v1/canvas/projects`） |
| `POST /infinite-canvas/projects` | 按 Web 应用自身的项目数据结构创建空画布 |
| `POST /infinite-canvas/target` | 设置客户端应切换到的画布，或用 `{canvasId: ''}` 清除目标；`blocked: true` 表示浏览器拒绝打开 |
| `GET /infinite-canvas/open?canvas=<id>` | 通过 302 跳转到携带凭证的画布页面，可将此路由链接贴到聊天中 |
| `POST /infinite-canvas/canvas-token` | 通过列出画布验证令牌，然后保存或清除令牌 |
| `POST /infinite-canvas/link` | 返回携带凭证的浏览器链接；可选 `{canvasId}` 用于指定画布 |

**如何在不新开标签页的情况下打开新建画布。** 创建画布后，插件在内存中保存 `pending` 目标，
并通过 `GET /state` 返回。客户端轮询状态，然后调用
`window.open(credentialedUrl, 'dsh-infinite-canvas')`。导航到一个已经打开的具名窗口不需要用户手势，
因此只会将原有画布标签页切换到新画布，Agent 始终只看到一个已连接的画布。
切换目标仅保存在内存中，不写入设置。

如果画布标签页尚未打开，浏览器会拦截该调用。客户端通过 `POST /infinite-canvas/target`
上报 `blocked: true`，随后 `infinite_canvas_status` 返回 `pendingBlocked` 和 `openLink`。
模型可以将该链接贴到聊天中：链接指向 `GET /infinite-canvas/open?canvas=<id>`，
由该路由通过 302 跳转到携带凭证的画布页面，因此令牌留在跳转 URL 的 hash 中，不出现在消息里。
点击一次即可打开画布，无需手动配置。（这两种行为均已通过 CDP 在真实 Chrome 中验证。）

画布站使用 `Authorization: Bearer <token>` 认证。该令牌属于已登录用户，
保存在 `$DSH_HOME/infinite-canvas/canvas-api.json` 中（权限 `0600`，不会通过任何路由返回）。
可在画布站使用以下代码获取令牌；设置表单中也展示了这段可复制的代码：

```js
Object.entries(localStorage).forEach(([key, value]) => {
  try {
    const { state = {} } = JSON.parse(value)
    if (state.token) console.log(state.token)
  } catch {}
})
```

模型使用 `infinite_canvas_projects`，参数为 `action: list | create`。
当用户指定某个画布时，先列出画布，再按标题或 ID 匹配；仅在用户要求新建时创建画布。

## 默认值与存储位置

| 配置项 | 默认值 | 修改方式 |
| --- | --- | --- |
| 画布站地址 | `https://infic.transiglobal.com` | 「设置 → 无限画布」，或行配置中的 `canvasBaseUrl` |
| 要打开的画布 | 始终为画布站列表 `/canvas` | 无需配置，不保存画布 ID |
| 本地 Agent | `http://127.0.0.1:3210` | 「设置 → 无限画布」，或 `agentUrl` |
| 在打开的链接中携带 Agent 凭证 | 开启 | 「设置 → 无限画布」，或 `embedCredentials` |
| 随 Harness 启动 Agent | 开启 | 「设置 → 无限画布」，或 `autoStart` |
| Agent 命令及参数 | `npx -y @tigerowo/canvas-agent@latest` | 行配置中的 `agentCommand`、`agentArgs` |
| MCP 服务命名空间 | `infinite-canvas` | `cordis.patch.yml` 中的 `serverName` |
| 多画布客户端 ID | 未设置 | `cordis.patch.yml` 中的 `env.CANVAS_AGENT_CLIENT_ID` |

通过界面修改的设置保存在 `$DSH_HOME/infinite-canvas/settings.json`，无需重新加载插件即可生效。
`cordis.patch.yml` 中的行配置作为默认层，用户的补丁层在升级后仍会保留。
Agent 的控制台输出保存在 `$DSH_HOME/infinite-canvas/agent.log`，其中类似令牌的内容会被替换为 `<token>`。

## 插件行配置

```yaml
- id: infinite-canvas            # Host half of this package (+ autostart supervisor)
- id: infinite-canvas-mcp        # '@deepseek-ai/dsh-mcp-client', stdio -> npx ... mcp
```

## 进程监管状态

| 状态 | 含义 |
| --- | --- |
| `starting` | 子进程已启动，正在等待其响应 `GET /config` |
| `running` | 插件启动的子进程已响应，可点击「停止 Agent」 |
| `external` | Agent 地址已有其他服务监听，插件不会再启动进程 |
| `stopped` | 已在设置中停止；在手动启动前，监管程序不会重新拉起进程 |
| `exited` / `error` | 子进程退出或始终未响应；监管程序会重试，最多 3 次 |

## 测试

```bash
node test/host.test.mjs      # Host half: routes, guards, supervisor, deployment API
node test/client.test.mjs    # Client half: renders the settings seat, drives the tab follower
```

Host 测试在模拟的 Cordis 上下文、`test/fake-agent.mjs` 和本地模拟画布站 API 上运行，
覆盖设置读写、同源检查、连接令牌处理、日志脱敏、真实的启动 → 就绪 → 停止周期，
以及画布 API（令牌验证、画布列表、新建画布、待切换目标和指定画布链接）。

Client 测试无需浏览器：使用约 100 行的 hook 运行时和模拟 `fetch` 渲染完整设置组件树，
再驱动后台标签页跟随逻辑。缺少辅助函数或组件抛出异常时，测试会失败，避免设置页出现空白。

## 限制与注意事项

- 画布是第三方 Web 应用，在普通浏览器标签页中打开，使用其自身的主题、控件和登录会话。
  设置页仅显示状态。
- 每次打开操作都指向同一个具名标签页 `dsh-infinite-canvas`，再次打开会导航到该标签页。
  Agent 仅支持一个已连接的画布；第二个标签页会使 `findSession` 报错「请只连接一个画布」，
  因此切换画布应在原画布页面中完成。
- 设置中不保存画布 ID。「打开画布」始终打开画布站列表；用户在其中选择或创建画布，
  画布页面在同一个标签页中自行保存选择。当前上下文取决于该标签页连接的画布，
  可通过 MCP 工具 `get_canvas_summary` 读取（`project.id`）。
- `infinite_canvas_projects` 通过列出画布、按标题或 ID 匹配，定位用户指定的画布，随后在该画布上工作。
  `action: create` 创建新画布后，客户端会将唯一的画布标签页切换过去。
  当前使用哪个画布由浏览器标签页决定，不作为插件设置保存。
- 仅在有画布页面连接时才提供画布工具；MCP 桥接会在画布连接后重新列出工具，无需重启。
- 强制退出 Harness 可能遗留子进程（正常卸载或禁用插件会停止进程）。
  如果 Agent 地址上的 `GET /config` 仍有响应，插件会将其视为 `external`，不会重复启动。
- 画布 API 令牌属于用户凭证，以 `0600` 权限保存在本地，仅发送到画布站自身的源，
  不会发送给 Agent 或模型。
- 插件 API 路由位于 Harness Web 服务的 `/infinite-canvas` 下，受同源检查保护，
  不会在跨源可读响应中包含令牌。连接令牌只会通过同源的 `POST /infinite-canvas/token` 返回，
  或嵌入 `POST /infinite-canvas/link` 返回的链接中。
