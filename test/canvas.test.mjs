import assert from 'node:assert/strict'
import { createCanvasOperations, revisionOf } from '../canvas-operations.js'
const clone = (v) => structuredClone(v)
const base = () => ({ id: 'p1', title: 'Original', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', autoTitlePending: true, unknownField: { preserve: true }, nodes: [
  { id: 'a', type: 'text', title: 'A', position: { x: 0, y: 0 }, width: 340, height: 240, metadata: { content: 'Original A', other: 17 } },
  { id: 'b', type: 'text', title: 'B', position: { x: 440, y: 0 }, width: 340, height: 240, metadata: { content: 'Original B' } },
], connections: [], chatSessions: [{ messages: [{ content: 'preserve chat', references: [{ id: 'a', url: 'https://example.com/a', storageKey: 'shared' }] }] }] })
let project = base(), calls = [], failure = null, task = null, beforeGet = null, afterSave = null
const api = async (req) => {
  calls.push(clone(req))
  if (req.path === '/canvas/projects' && req.method === 'GET') { beforeGet?.(); return [clone(project)] }
  if (req.path === '/canvas/projects' && req.method === 'POST') { project = clone(req.body.data); const saved = clone(project); afterSave?.(); return saved }
  if (req.method === 'POST' && ['/canvas/image-tasks', '/canvas/audio-tasks', '/videos'].includes(req.path)) {
    if (failure) throw new Error(failure)
    task = { id: req.body.clientTaskId ?? req.clientTaskId, status: 'queued' }; return clone(task)
  }
  if (req.path.startsWith('/canvas/image-tasks/') || req.path.startsWith('/canvas/audio-tasks/') || req.path.startsWith('/videos/')) return clone(task)
  if (req.path === '/canvas/tasks/stop') return { stopped: true }
  if (req.path === '/settings') return { modelChannel: { channels: [{ id: 'channel-1', models: ['example-model'] }] } }
  if (req.path === '/workflows') return []
  throw new Error(`unexpected API route ${req.path}`)
}
const ops = createCanvasOperations(api)
let count = 0
const check = (label, run) => { run(); count++; console.log(`PASS ${label}`) }
const write = (action, rest = {}) => ops.nodes({ canvasId: 'p1', action, expectedRevision: revisionOf(project), ...rest })
const original = clone(project)
let result = await ops.nodes({ canvasId: 'p1', action: 'summary' })
check('reads return a revision and preserve unknown data', () => { assert.equal(result.project.revision, revisionOf(project)); assert.deepEqual(project, original) })
await assert.rejects(write('update_text', { nodeId: 'a', content: 'bad', expectedRevision: 'stale' }), /expectedRevision/)
check('stale writes cannot touch backend', () => assert.equal(calls.filter((c) => c.method === 'POST').length, 0))
result = await write('create_text', { title: 'Child', content: 'New text', sourceNodeIds: ['a'] })
const child = result.nodeId
check('new node and source connection are persisted without a browser', () => { assert(project.nodes.some((n) => n.id === child)); assert(project.connections.some((c) => c.fromNodeId === 'a' && c.toNodeId === child)); assert.deepEqual(project.unknownField, original.unknownField); assert.equal(project.chatSessions[0].messages[0].content, 'preserve chat') })
await write('update_text', { nodeId: 'a', content: '' })
check('text can be cleared without dropping unrelated metadata', () => { assert.equal(project.nodes[0].metadata.content, ''); assert.equal(project.nodes[0].metadata.other, 17) })
await write('connect', { fromNodeId: 'a', toNodeId: child })
check('duplicate connections are idempotent', () => assert.equal(project.connections.length, 1))
await assert.rejects(write('connect', { fromNodeId: 'a', toNodeId: 'a' }), /不允许/)
await assert.rejects(write('group', { nodeIds: ['missing', 'a'] }), /不存在/)
result = await write('group', { nodeIds: ['a', 'b'], title: 'Group' })
const groupId = result.groupId, positions = clone(project.nodes.filter((n) => ['a', 'b'].includes(n.id)).map((n) => n.position))
const group = project.nodes.find((n) => n.id === groupId)
await write('move', { nodeId: groupId, x: group.position.x + 50, y: group.position.y + 25 })
check('moving groups moves their children', () => project.nodes.filter((n) => ['a', 'b'].includes(n.id)).forEach((n, i) => assert.deepEqual(n.position, { x: positions[i].x + 50, y: positions[i].y + 25 })))
await assert.rejects(write('group', { nodeIds: ['a', child] }), /未分组/)
await assert.rejects(write('arrange', { nodeIds: ['a'] }), /顶层/)
await write('arrange')
await write('delete', { nodeId: groupId })
check('deleting a group preserves and ungroups children', () => { assert(project.nodes.some((n) => n.id === 'a')); assert.equal(project.nodes.find((n) => n.id === 'a').metadata.groupId, undefined) })
await write('delete', { nodeId: 'a' })
check('node deletion removes edges and stale chat asset references', () => { assert.equal(project.connections.length, 0); assert.equal(project.chatSessions[0].messages[0].references[0].url, undefined); assert.equal(project.chatSessions[0].messages[0].references[0].storageKey, undefined); assert.equal(calls.some((c) => c.path.includes('/files') || c.path.includes('/delete')), false) })
await write('create_primary_script', { title: 'Script', projectTitle: 'New project title', content: 'Script body' })
check('primary script uses the established size and project title', () => { assert.equal(project.title, 'New project title'); assert(project.nodes.some((n) => n.width === 550 && n.height === 600)); assert.equal(project.autoTitlePending, false) })
const rev = revisionOf(project)
const writes = await Promise.allSettled([write('rename', { nodeId: 'b', title: 'First', expectedRevision: rev }), write('rename', { nodeId: 'b', title: 'Second', expectedRevision: rev })])
check('concurrent same-revision writes cannot both overwrite', () => { assert.equal(writes.filter((v) => v.status === 'fulfilled').length, 1); assert.equal(project.nodes.find((n) => n.id === 'b').title, 'First') })
let gets = 0
beforeGet = () => { if (++gets === 2) project.title = 'External browser edit' }
await assert.rejects(write('rename', { nodeId: 'b', title: 'lost' }), /版本冲突/)
beforeGet = null
check('a change discovered before save is preserved', () => assert.equal(project.title, 'External browser edit'))
result = await write('create_media', { kind: 'image', title: 'Image', prompt: 'test', sourceNodeIds: ['b'] })
const mediaId = result.nodeId
check('preparing media does not start generation', () => assert.equal(calls.some((c) => c.path === '/canvas/image-tasks'), false))
await assert.rejects(ops.media({ canvasId: 'p1', nodeId: mediaId, action: 'submit', expectedRevision: revisionOf(project), request: { prompt: 'test' } }), /model/)
await assert.rejects(ops.media({ canvasId: 'p1', nodeId: mediaId, action: 'submit', expectedRevision: revisionOf(project), channelId: 'channel-1', request: { model: 'example-model', api_key: 'not-allowed' } }), /不能包含凭证/)
result = await ops.media({ canvasId: 'p1', nodeId: mediaId, action: 'submit', expectedRevision: revisionOf(project), channelId: 'channel-1', request: { model: 'example-model', prompt: 'test', max_tokens: 10 } })
check('media submit binds an explicit channel, canvas, node and recoverable task ID', () => { assert(result.ok); const submitted = calls.find((c) => c.path === '/canvas/image-tasks'); assert.equal(submitted.channelId, 'channel-1'); assert.equal(submitted.body.nodeId, mediaId); assert.equal(submitted.body.sourceId, 'p1'); assert.equal(submitted.body.requestBody.model, 'example-model') })
await assert.rejects(ops.media({ canvasId: 'p1', nodeId: mediaId, action: 'submit', expectedRevision: revisionOf(project), channelId: 'channel-1', request: { model: 'example-model' } }), /已有提交/)
task = { ...task, status: 'completed', url: 'https://example.com/result.png', width: 1024, height: 768 }
const beforeStatus = clone(project)
await ops.media({ canvasId: 'p1', nodeId: mediaId, action: 'status' })
check('task status is read-only', () => assert.deepEqual(project, beforeStatus))
await ops.media({ canvasId: 'p1', nodeId: mediaId, action: 'sync', expectedRevision: revisionOf(project) })
check('task sync persists result URL and media metadata', () => { const m = project.nodes.find((n) => n.id === mediaId).metadata; assert.equal(m.content, task.url); assert.equal(m.status, 'success'); assert.equal(m.naturalWidth, 1024) })
result = await write('create_media', { kind: 'image', title: 'Unknown submission' })
failure = 'timeout'
result = await ops.media({ canvasId: 'p1', nodeId: result.nodeId, action: 'submit', expectedRevision: revisionOf(project), channelId: 'channel-1', request: { model: 'example-model' } })
check('uncertain submissions return the persisted ID and are not retried', () => { assert.equal(result.uncertainSubmission, true); assert.equal(project.nodes.find((n) => n.id === result.nodeId).metadata.imageTaskId, result.taskId); assert.equal(project.nodes.find((n) => n.id === result.nodeId).metadata.apiSubmission, 'submitting') })
const catalog = await ops.catalog({ resource: 'models' })
check('model catalog returns public channel data', () => assert.equal(catalog.data.channels[0].id, 'channel-1'))
await assert.rejects(ops.catalog({ resource: 'skill_file', skillId: 'x', path: '../secret' }), /相对路径/)
failure = null
for (const kind of ['audio', 'video']) {
  const prepared = await write('create_media', { kind, title: `${kind} task` })
  const submitted = await ops.media({ action: 'submit', canvasId: 'p1', nodeId: prepared.nodeId, expectedRevision: revisionOf(project), channelId: 'channel-1', request: { model: 'example-model', input: 'hello', prompt: 'scene' } })
  task = { ...task, status: 'completed', url: `https://example.com/${kind}.file` }
  await ops.media({ action: 'sync', canvasId: 'p1', nodeId: prepared.nodeId, expectedRevision: revisionOf(project) })
  check(`${kind} task submission and primary result sync`, () => { assert(submitted.ok); assert.equal(project.nodes.find((n) => n.id === prepared.nodeId).metadata.content, task.url); assert.equal(project.nodes.find((n) => n.id === prepared.nodeId).metadata.prompt, 'scene') })
  await ops.media({ action: 'stop', canvasId: 'p1', nodeId: prepared.nodeId })
  check(`${kind} task cancellation uses the backend task ID`, () => { const request = calls.at(-1); assert.equal(request.path, '/canvas/tasks/stop'); assert.equal(request.body.kind, kind); assert.equal(request.body.id, task.id) })
}
project = base()
project.nodes.push(
 { id: 'root', type: 'image', position: { x: 0, y: 0 }, width: 420, height: 236, metadata: { isBatchRoot: true, batchChildIds: ['i1', 'i2'], primaryImageId: 'i1', content: 'first' } },
 { id: 'i1', type: 'image', metadata: { batchRootId: 'root', content: 'first' } },
 { id: 'i2', type: 'image', metadata: { batchRootId: 'root', content: 'second', status: 'success' } },
 { id: 'empty-root', type: 'image', metadata: { isBatchRoot: true, batchChildIds: [] } })
await write('delete', { nodeId: 'i1' })
check('deleting the primary batch child selects a remaining result', () => { const root = project.nodes.find((n) => n.id === 'root'); assert.equal(root.metadata.primaryImageId, 'i2'); assert.equal(root.metadata.content, 'second') })
await write('delete', { nodeId: 'i2' })
check('deleting the last batch child removes its root without touching unrelated empty roots', () => { assert(!project.nodes.some((n) => n.id === 'root')); assert(project.nodes.some((n) => n.id === 'empty-root')) })
project = base()
afterSave = () => { project.title = 'Concurrent change after POST' }
await assert.rejects(write('rename', { nodeId: 'a', title: 'attempt' }), /回读不一致/)
afterSave = null
check('a post-save race is reported instead of claiming verified success', () => assert.equal(project.title, 'Concurrent change after POST'))
console.log(`\n${count} scenario groups passed`)
