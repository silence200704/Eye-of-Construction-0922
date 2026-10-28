import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fixture } from '../fixture.mjs'

test('reported issue and task are server rows in workspace, keep newer task revisions', async () => {
 const f = fixture()
 await f.controller.connect('http://localhost:8080', 'demo-inspector')
 assert.ok(f.controller.fieldAccess())
 const task = { id: 't1', rev: 4, results: [], planSnapshot: { pointIds: [] } }
 f.current().workspace.tasks.push(task)
 const issue = { id: 'i1', issueNo: 'IS1', pointId: 'point-inspector', buildingId: 'B1', photos: [], rev: 1 }
 f.controller.acceptReport({ issue, task: { ...task, rev: 3 } })
 assert.equal(f.current().workspace.tasks[0].rev, 4)
 assert.equal(f.current().workspace.issues[0].id, 'i1')
 await f.controller.select('demo-property')
 assert.equal(f.current().workspace.issues.length, 0)
 f.controller.suspend(); assert.equal(f.controller.fieldAccess(), null)
})
