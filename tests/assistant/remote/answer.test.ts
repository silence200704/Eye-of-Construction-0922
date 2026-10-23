import { describe, expect, it } from 'vitest'
import { mapServerAnswer } from '@/assistant/remote/answer'
import type { RemoteAnswer, RemoteCitation } from '@/api/backend/assistant'

const citation: RemoteCitation = {
  documentId: 'doc_1',
  chunkId: 'chk_1',
  title: '预警分级与处置要求',
  version: 2,
  sha256: 'abc',
  lineStart: 1,
  lineEnd: 4,
  sourcePath: 'docs/knowledge/分级.md',
  methods: ['keyword'],
}

function answer(overrides: Partial<RemoteAnswer> = {}): RemoteAnswer {
  return {
    intent: 'point_status',
    status: 'answered',
    conclusion: '当前读数 0.42 mm。',
    facts: [{ label: '当前读数', value: '0.42', unit: 'mm' }],
    evidence: [{ kind: 'record', ref: 'R-1', id: 'rec_1', detail: '有效记录' }],
    gaps: [],
    links: [{ kind: 'point_trend', objectId: 'pnt_1' }],
    sources: { facts: 'server_db', queriedAt: '2026-10-23T10:00:00+08:00' },
    objects: {
      pointId: 'pnt_1',
      eventId: null,
      issueId: null,
      workOrderId: null,
      buildingId: 'bld_1',
    },
    ...overrides,
  }
}

describe('服务端回答映射', () => {
  it('服务端省略 gaps 时按空处理，不因缺字段整条失败', () => {
    const raw = answer()
    delete (raw as { gaps?: string[] }).gaps
    const result = mapServerAnswer(raw, 'B03-F2-CRACK01 现在怎么样')
    expect(result.status).toBe('answered')
    expect(result.gaps).toEqual([])
  })

  it('业务事实、对象与导航保留，引用单列', () => {
    const result = mapServerAnswer(
      answer({ citations: [citation], knowledge: { decision: 'answer', mode: 'hybrid', indexVersion: 'idx1' } }),
      'B03-F2-CRACK01 现在怎么样',
    )
    expect(result.intent).toBe('point_status')
    expect(result.status).toBe('answered')
    expect(result.pointId).toBe('pnt_1')
    expect(result.facts).toEqual([{ label: '当前读数', value: '0.42', unit: 'mm' }])
    expect(result.citations?.[0].chunkId).toBe('chk_1')
    expect(result.sources?.facts).toBe('server_db')
    expect(result.sources?.knowledge).toBeUndefined()
    expect(result.knowledge?.decision).toBe('answer')
    expect(result.links.map((row) => row.kind)).toEqual(['point_trend'])
    expect(result.pendingCommands).toEqual([])
    expect(result.context).toEqual({ pointId: 'pnt_1' })
  })

  it('知识澄清的候选依据只进引用区，不变成可继续追问的对象', () => {
    const result = mapServerAnswer(
      answer({
        intent: 'knowledge',
        status: 'clarify',
        conclusion: '多个知识主题接近，请补充对象。',
        facts: [],
        evidence: [],
        citations: [],
        candidates: [citation],
        knowledge: { decision: 'clarify', mode: 'keyword', indexVersion: null, reason: '多个知识主题接近' },
        sources: { facts: 'none', knowledge: 'local_kb', queriedAt: '2026-10-23T10:00:00+08:00' },
        objects: {
          pointId: null,
          eventId: null,
          issueId: null,
          workOrderId: null,
          buildingId: null,
        },
      }),
      '这个怎么判定',
    )
    expect(result.status).toBe('need_choice')
    expect(result.candidates).toEqual([])
    expect(result.citations?.[0].chunkId).toBe('chk_1')
    expect(result.sources?.facts).toBe('none')
  })

  it('无依据不生成事实，写入请求只给白名单入口', () => {
    const empty = mapServerAnswer(
      answer({
        intent: 'knowledge',
        status: 'unsupported',
        conclusion: '当前本地知识库没有足够依据。',
        facts: [],
        evidence: [],
        gaps: ['no_basis'],
        links: [],
        knowledge: { decision: 'no_basis', mode: 'keyword', indexVersion: null },
        sources: { facts: 'none', queriedAt: '2026-10-23T10:00:00+08:00' },
      }),
      '学校食堂菜单',
    )
    expect(empty.status).toBe('unsupported')
    expect(empty.facts).toEqual([])
    expect(empty.gaps[0]).toContain('没有足够依据')

    const write = mapServerAnswer(
      answer({
        intent: 'demo_command',
        status: 'unsupported',
        conclusion: '本次提问没有修改任何记录。',
        facts: [],
        evidence: [],
        gaps: ['write_requires_workbench'],
        links: [{ kind: 'settings', objectId: '' }],
      }),
      '准备一次红色预警演示数据',
    )
    expect(write.intent).toBe('demo_command')
    expect(write.links.map((row) => row.path)).toEqual(['/settings'])
    expect(write.pendingCommands).toEqual([])
    expect(write.gaps[0]).toContain('写入')
  })
})
