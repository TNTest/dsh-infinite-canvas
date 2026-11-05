# dsh-infinite-canvas

[English](README.md) | [简体中文](README.zh-CN.md)

通过用户 API Key，让 DeepSeek Harness 直接操作后端已保存的 [Infinite Canvas](https://github.com/TNTest/infinite-canvas) 画布。另保留独立、可选的本地 Agent 启动器，供画布网页使用。

## 快速开始

1. 通过 `https://github.com/TNTest/dsh-infinite-canvas` 安装插件包。
2. 打开「设置 → 无限画布」，默认站点为 `https://infic.transiglobal.com`。
3. 在画布站「账户 → API Key」创建专用的 `ic_` 用户 Key，粘贴到插件后点击「验证并保存」。读取需要 `read`，编辑画布需要 `read + write`，生成需要 `generate`，删除资源需要 `delete`。
4. 让 Harness 列出、新建或编辑画布。浏览器关闭、本地 Agent 停止时，后端工具仍然可用；插件自动注册内置的 `infinite-canvas` skill。
5. 「查看画布」是可选入口。网页已经打开时，请先保存网页改动，再执行 API 操作，完成后刷新网页查看结果。

无需在浏览器控制台获取登录 Token。API 鉴权也不会代替浏览器登录网站。

## 两条独立链路

| 链路 | 用途 | 依赖 |
| --- | --- | --- |
| 后端 API 工具 | 已保存画布、节点、连线、分组、布局和后端媒体任务 | 站点地址和 API Key |
| 可选网页 Agent 启动器 | 一键启停画布网页右侧智能体使用的本地 Agent | Node.js 22+、`npx`；使用网页智能体时需打开画布页面 |

启动器保留随 Harness 启动、可配置的本地地址，以及「打开网页并连接 Agent」。默认命令为 `npx -y @tigerowo/canvas-agent@latest`，首次启动可能需要下载依赖。插件自动读取 Agent 连接令牌，仅在明确打开网页并连接时用于握手；它与用户 API Key 相互独立。

新建、编辑画布不会打开或切换浏览器标签页。后端编辑不再依赖 stdio MCP 桥。为兼容旧版升级，保留但默认停用 `infinite-canvas-mcp` 行；如果旧配置覆盖层显式启用了该行，请将其停用。网页端 Agent 不需要这条 Harness MCP 配置。

## 智能体工具

| 工具 | 操作 |
| --- | --- |
| `infinite_canvas_status` | 独立检查后端连接和可选启动器状态 |
| `infinite_canvas_projects` | `list`、`create`、`rename`、`delete`；`open` 仅返回普通查看链接 |
| `infinite_canvas_nodes` | `summary`、`query`、`get`、`upstream`、`downstream`、`connected`；`create_text`、`create_primary_script`、`create_media`、`update_text`、`rename`、`move`、`delete`、`connect`、`disconnect`、`group`、`arrange` |
| `infinite_canvas_catalog` | 查询公开模型/渠道、已保存工作流、个人/系统技能和系统技能文件 |
| `infinite_canvas_media` | `submit`、只读 `status`、将结果回填节点的 `sync`、停止后端任务的 `stop` |

节点和媒体调用都需明确指定 `canvasId`。读取返回 `project.revision`；编辑节点、重命名/删除画布、提交/回填媒体任务时，需提供最新的 `expectedRevision`。写入保留项目中无关字段，并回读确认结果。同一插件内的写操作按画布串行执行，已知过期版本会被拒绝。**当前后端没有原子版本比较更新接口**，因此网页与 API 同时编辑仍可能竞争，不能将这些检查视为实时协同同步。

删除节点会清理画布连线、分组/批次成员关系和聊天中失效的媒体引用，但保留实际文件、后端任务及生成历史。不支持嵌套分组或对批次节点分组；单独移动批次节点及批次布局仍由网页完成。鼠标选区、网页未保存状态、本地 Codex 会话和浏览器私有模型配置不属于这套 API 的能力。

## 后端媒体任务

先用 `create_media` 准备图片、视频或音频节点，该操作不会开始生成。`submit` 需明确提供后端 `channelId`，以及包含 `model` 和模型所需参数的 `request` JSON 对象，不能将 Key 放入该对象。支持 JSON 的图片编辑请求可使用 `edit: true`，并明确提供参考素材。

`status` 只读取任务；`sync` 将当前任务状态、主要结果地址和媒体元数据写入节点。额外结果地址保留在任务响应中，不复刻网页批次结果界面。工具可发现工作流，但暂不实现工作流执行、multipart 上传、浏览器本地渠道或任意模型专用参数转译。

生成需要用户授权，并可能消耗算力点。提交请求前会保存任务 ID，已提交节点不能再次提交。超时导致提交结果不确定时，应先按保留的任务 ID 查询，不要重发。停止任务不等于删除，也不保证退款。即使画布可编辑，仍需满足对应权限、模型请求格式和渠道可用性。

## 凭证与本地文件

- 界面设置：`$DSH_HOME/infinite-canvas/settings.json`。
- API Key：`$DSH_HOME/infinite-canvas/canvas-api.json`，权限 `0600`，绑定已验证的站点地址；`CANVAS_API_KEY` 可覆盖插件行配置中站点对应的 Key。
- 可选网页 Agent 令牌：`~/.infinite-canvas/codex-agent.json`；启动器脱敏日志：`$DSH_HOME/infinite-canvas/agent.log`。

Key 仅通过 `Authorization` 请求头发送，不放入链接或模型工具输出。远程站点必须使用 HTTPS，本机测试允许 HTTP。带认证的请求不跟随重定向。更换站点后，旧 Key 不再可用，需为新地址重新验证 Key。

## 验证

```bash
node test/canvas.test.mjs
node test/host.test.mjs
node test/client.test.mjs
npm pack --dry-run --ignore-scripts
```

测试覆盖图结构编辑与数据保留、版本冲突、分组移动、模拟媒体任务的提交/恢复/回填、HTTP 凭证隔离、本地 Agent 停止时的后端编辑、可选 Agent 启停，以及无自动浏览器导航的设置页渲染。真实收费生成需要针对所选模型和渠道另行授权验收。
