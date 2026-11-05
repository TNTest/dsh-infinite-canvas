# dsh-infinite-canvas

[English](README.md) | [简体中文](README.zh-CN.md)

通过用户 API Key、精简设置页和实时画布 MCP 工具，将 [Infinite Canvas](https://github.com/TNTest/infinite-canvas) 接入 DeepSeek Harness。

## 快速开始

1. 在 Harness 中通过 `https://github.com/TNTest/dsh-infinite-canvas` 安装本插件包。
2. 打开「设置 → 无限画布」。默认站点为 `https://infic.transiglobal.com`。
3. 在画布站的「账户 → API Key」创建 `ic_` 开头的专用用户 Key。列出画布需要 `read`，新建画布需要 `read + write`。将 Key 粘贴到插件中，点击「验证并保存」。无需浏览器控制台或会话 Token。
4. 点击「打开画布」，或在「我的画布」中打开指定画布。如果画布站要求登录，需单独登录；只保留一个已连接的画布标签页。
5. 告诉智能体要在哪张画布上完成什么任务。内置的 `infinite-canvas` skill 会引导它选择画布、检查连接并编辑。

本机需要 Node.js 22+ 和 `npx`。插件会自动启动并监管 `npx -y @tigerowo/canvas-agent@latest`；首次启动需要下载依赖，可能耗时较长。

## 插件功能

- 配置站点地址和用户 API Key，显示账户画布列表，支持直接打开指定画布。
- 提供 `infinite_canvas_projects`，支持 `list`、`create`、`open`。新建需要 `read + write`；打开操作通过 ID 选择已有画布。
- 提供 `infinite_canvas_status`，查询本地 Agent、实时画布连接及浏览器打开状态。
- 将官方 canvas-agent MCP 工具接入为 `mcp__infinite-canvas__<tool>`。实时节点编辑需要画布页面连接到本地 Agent。
- 插件启用时自动注册内置的 `infinite-canvas` skill，无需单独安装技能。

API Key 用于后端接口鉴权，不会将浏览器登录到画布站，也不替代本地 Agent 的连接令牌。插件自动读取 Agent 令牌，仅用于浏览器连接握手；用户 API Key 不会出现在浏览器链接中。

智能体新建或打开画布时，插件尝试复用同一个具名浏览器标签页。如果浏览器拦截打开，智能体可将 `infinite_canvas_status` 返回的 `openLink` 交给用户。编辑前，skill 要求调用 `get_canvas_summary`，核对目标画布 ID。

## 配置与凭证

常规使用只需填写站点地址和用户 API Key。「高级设置」包含本地 Agent 地址（默认 `http://127.0.0.1:3210`）、自动启动和浏览器自动连接。诊断日志默认收起。

| 项目 | 位置或配置方式 |
| --- | --- |
| 界面设置 | `$DSH_HOME/infinite-canvas/settings.json` |
| 用户 API Key | `$DSH_HOME/infinite-canvas/canvas-api.json`，权限 `0600`，绑定到已验证的站点地址 |
| 环境变量覆盖 | `CANVAS_API_KEY`，仅用于插件行配置中的站点地址 |
| 本地 Agent 连接令牌 | `~/.infinite-canvas/codex-agent.json`，由 canvas-agent 写入 |
| 脱敏 Agent 日志 | `$DSH_HOME/infinite-canvas/agent.log` |
| 插件行与命令默认值 | `cordis.patch.yml` |

Key 仅通过 `Authorization` 请求头发送。远程站点必须使用 HTTPS，本机测试允许 HTTP。带认证的 API 请求不会跟随重定向。更换站点地址后，旧 Key 不再可用，需要为新地址重新验证 Key；旧浏览器会话 Token 不会继续使用。

Key 不会出现在状态响应、模型工具输出或日志中。`401` 表示 Key 无效、过期或已撤销；`403` 表示权限不足或请求额度耗尽；`429` 表示需要等待后重试。生成操作可能消耗账户算力点，仅应在用户要求时执行。

更改本地 Agent 端口时，还需在 Harness 配置覆盖层的 `infinite-canvas-mcp` 行设置 `env.CANVAS_AGENT_PORT`，然后重启 Harness，两端端口必须一致。如果其他画布会话已占用 `3210`，可以使用独立端口。

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

界面设置的优先级高于行配置默认值，需在「高级设置」中同步修改为相同地址。

## 使用边界

- 后端对接 [TNTest/infinite-canvas](https://github.com/TNTest/infinite-canvas) 的 API Key 能力，使用 `{ code, data, msg }` 响应格式。
- 列出和新建画布通过后端完成；实时节点工具仍需浏览器和本地 Agent。多个已连接标签页可能导致 Agent 无法判断目标。
- 插件设置不保存画布选择，当前编辑上下文由已连接的浏览器标签页决定。
- 插件卸载时会停止其托管的 Agent。强制退出 Harness 可能遗留进程，下次启动会检测已有服务。

## 验证

```bash
node test/host.test.mjs
node test/client.test.mjs
npm pack --dry-run --ignore-scripts
```

Host 测试覆盖 API Key 验证与站点绑定、权限和限流错误、同源检查、画布操作、skill 注册和 Agent 监管。Client 测试渲染设置页并验证配置交互及单标签页切换。测试使用虚构凭证和本地模拟服务。
