/**
 * 服务端小瞳回答 → 界面稳定的 AskResult。
 *
 * 服务端只给业务事实、对象、知识引用与白名单导航；前端不重新解释结论，
 * 也不把引用混进 facts —— 业务事实与知识来源在卡片里分列。
 */
import { buildLink, buildSpatialLink } from '../actions'
import type {
  AskCandidate,
  AskCitation,
  AskContext,
  AskEvidence,
  AskIntent,
  AskKnowledgeMeta,
  AskLink,
  AskResult,
  AskSources,
  AskStatus,
} from '../types'
import type { RemoteAnswer, RemoteCitation } from '@/api/backend/assistant'
import { useArchiveStore } from '@/stores/archive'

const STATUS: Record<string, AskStatus> = {
  answered: 'answered',
  need_choice: 'need_choice',
  clarify: 'need_choice',
  not_found: 'not_found',
  unsupported: 'unsupported',
}

const GAPS: Record<string, string> = {
  point_required: '请先指明或选择一个测点；本次回答没有使用默认对象。',
  event_required: '请先指明或选择一条预警事件；本次回答没有猜测对象。',
  issue_required: '请指明问题编号或先选择相关测点；当前没有可绑定的问题。',
  knowledge_clarify: '知识问题需要补充对象或动作，候选依据尚未选定。',
  no_basis: '本地知识库没有足够依据；没有引用、也没有推测。',
  retrieval_unavailable: '本地知识检索不可用；业务事实仍可在对应页面查询。',
  write_requires_workbench: '写入或演示准备请到系统设置或对应工作台执行，提问不会改库。',
  no_object: '当前问句没有可绑定的业务对象。',
}

function gapText(code: string): string {
  return GAPS[code] ?? `当前回答有未满足的条件：${code}`
}

function statusOf(value: string): AskStatus {
  return STATUS[value] ?? 'unsupported'
}

function citationsOf(rows: RemoteCitation[] | undefined): AskCitation[] {
  return (rows ?? []).map((row) => ({
    documentId: row.documentId,
    chunkId: row.chunkId,
    title: row.title,
    version: row.version,
    sha256: row.sha256,
    lineStart: row.lineStart,
    lineEnd: row.lineEnd,
    sourcePath: row.sourcePath,
    methods: row.methods,
  }))
}

function isCitationRow(row: unknown): row is RemoteCitation {
  return typeof row === 'object' && row !== null && 'chunkId' in row
}

/** 知识题的候选依据也放进引用区（可打开核对），不伪装成可继续追问的对象。 */
function knowledgeCitations(answer: RemoteAnswer): AskCitation[] {
  const selected = citationsOf(answer.citations)
  if (selected.length > 0) return selected
  const rows = answer.candidates ?? []
  return citationsOf(rows.filter(isCitationRow))
}

function candidatesOf(answer: RemoteAnswer): AskCandidate[] {
  const rows = answer.candidates ?? []
  if (rows.length === 0) return []
  if (isCitationRow(rows[0])) return []
  return (rows as { id: string; label: string; detail: string }[]).map((row) => ({ ...row }))
}

/** 3D 深链要楼栋/楼层：按服务端给出的测点 ID 在当前档案里补，找不到就退回页面级链接。 */
function linkOf(kind: string, objectId: string): AskLink | null {
  if (kind === 'spatial_3d') {
    const archive = useArchiveStore()
    const point = objectId === '' ? undefined : archive.points.find((row) => row.id === objectId)
    if (point !== undefined) {
      return buildSpatialLink({
        buildingId: point.buildingId,
        floorId: point.floorId,
        pointId: point.id,
      })
    }
  }
  try {
    return buildLink(kind as AskLink['kind'], objectId)
  } catch {
    return null
  }
}

function linksOf(answer: RemoteAnswer): AskLink[] {
  const out: AskLink[] = []
  const seen = new Set<string>()
  for (const row of answer.links) {
    const link = linkOf(row.kind, row.objectId)
    if (link === null) continue
    const key = `${link.kind}|${link.path}|${JSON.stringify(link.query)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(link)
  }
  return out
}

function contextOf(answer: RemoteAnswer): AskContext {
  const objects = answer.objects
  const context: AskContext = {}
  if (objects.pointId) context.pointId = objects.pointId
  if (objects.eventId) context.eventId = objects.eventId
  return context
}

export function mapServerAnswer(
  answer: RemoteAnswer,
  question: string,
  now = new Date().toISOString(),
): AskResult {
  const evidence: AskEvidence[] = answer.evidence
    .filter((row): row is AskEvidence => row.kind === 'record' || row.kind === 'event')
    .map((row) => ({ kind: row.kind as 'record' | 'event', ref: row.ref, id: row.id, detail: row.detail }))
  const sources: AskSources = {
    facts: answer.sources.facts,
    queriedAt: answer.sources.queriedAt || now,
    ...(answer.sources.knowledge ? { knowledge: answer.sources.knowledge } : {}),
  }
  const knowledge: AskKnowledgeMeta | undefined = answer.knowledge
  const isKnowledge = answer.intent === 'knowledge'
  return {
    question,
    intent: (answer.intent === 'knowledge' ? 'knowledge' : answer.intent) as AskIntent,
    status: statusOf(answer.status),
    pointId: answer.objects.pointId,
    conclusion: answer.conclusion,
    facts: answer.facts.map((row) => ({ ...row })),
    timing: null,
    provenance: null,
    evidence,
    candidates: isKnowledge ? [] : candidatesOf(answer),
    gaps: (answer.gaps ?? []).map(gapText),
    links: linksOf(answer),
    pendingCommands: [],
    guide: null,
    previews: [],
    dataNotes: [...(answer.dataNotes ?? [])],
    computedAt: sources.queriedAt,
    citations: isKnowledge ? knowledgeCitations(answer) : citationsOf(answer.citations),
    ...(knowledge ? { knowledge } : {}),
    sources,
    ...(Object.keys(contextOf(answer)).length > 0 ? { context: contextOf(answer) } : {}),
    ...(answer.followups && answer.followups.length > 0 ? { followups: answer.followups.slice(0, 3) } : {}),
  }
}
