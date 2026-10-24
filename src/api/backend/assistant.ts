/** 阶段 7：小瞳问答、会话与影像会话的服务端读写。 */
import { command, read } from './runtime'

export interface RemoteCitation {
  documentId: string
  chunkId: string
  title: string
  version: number
  sha256: string
  lineStart: number
  lineEnd: number
  sourcePath: string
  methods: string[]
}

export interface RemoteKnowledgeMeta {
  decision: 'answer' | 'clarify' | 'no_basis' | 'unavailable'
  mode: string
  indexVersion: string | null
  reason?: string
  excerpt?: string
}

export interface RemoteAnswer {
  intent: string
  status: string
  conclusion: string
  facts: { label: string; value: string; unit: string }[]
  evidence: { kind: string; ref: string; id: string; detail: string }[]
  citations?: RemoteCitation[]
  knowledge?: RemoteKnowledgeMeta
  candidates?: RemoteCitation[] | { id: string; label: string; detail: string }[]
  gaps?: string[]
  links: { kind: string; objectId: string }[]
  followups?: string[]
  dataNotes?: string[]
  sources: { facts: 'server_db' | 'none'; knowledge?: string; queriedAt: string }
  objects: {
    pointId: string | null
    eventId: string | null
    issueId: string | null
    workOrderId: string | null
    buildingId: string | null
  }
}

export interface RemoteTurn {
  id: string
  seq: number
  question: string
  answer: RemoteAnswer
  createdAt: string
}

export interface RemoteSession {
  id: string
  title: string
  turnCount: number
  createdAt: string
  updatedAt: string
  actorId: string
  turns?: RemoteTurn[]
}

export interface RemoteAskReply {
  sessionId: string
  turnId: string
  answer: RemoteAnswer
}

export interface RemoteMediaFrame {
  id: string
  pointId: string
  mediaId: string
  label: string
  capturedAt: string
  timeCode: number | null
  videoId?: string | null
  origin: string
  fileName: string
  size: number
  mimeType: string
  width: number
  height: number
  contentUrl: string
}

export interface RemoteComparison {
  id: string
  pointId: string
  before: RemoteMediaFrame
  after: RemoteMediaFrame
  result: Record<string, unknown>
}

export interface RemoteMediaSession {
  frames: RemoteMediaFrame[]
  comparisons: RemoteComparison[]
  videos: RemoteVideo[]
  latestSampleTime: string
}

export interface RemoteVideo {
  id: string
  pointId: string
  mediaId: string
  metadata: Record<string, unknown>
  analysis: Record<string, unknown> | null
  contentUrl: string
}

let sequence = 0

/** 幂等键只用于本次请求去重；浏览器 http 环境下 crypto.randomUUID 不一定可用。 */
function askKey(): string {
  sequence += 1
  return `assistant|${Date.now()}|${sequence}`
}

export async function askServer(input: {
  question: string
  sessionId?: string
  context?: Record<string, unknown>
}): Promise<RemoteAskReply> {
  const result = await command<RemoteAskReply>('/assistant/query', {
    body: {
      question: input.question,
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      context: input.context ?? {},
    },
    key: askKey(),
  })
  return result.data
}

export function fetchSessions(): Promise<RemoteSession[]> {
  return read<RemoteSession[]>('/assistant/sessions')
}

export function fetchSession(sessionId: string): Promise<RemoteSession> {
  return read<RemoteSession>(`/assistant/sessions/${encodeURIComponent(sessionId)}`)
}

export function registerSessionFrame(input: {
  mediaId: string
  pointId: string
  label: string
  capturedAt?: string | null
  timeCode?: number | null
  videoId?: string | null
}): Promise<RemoteMediaFrame> {
  return command<RemoteMediaFrame>('/media-sessions/frames', {
    body: input,
    key: `frame|${input.mediaId}|${input.pointId}`,
  }).then((result) => result.data)
}

export function fetchMediaSession(pointId: string): Promise<RemoteMediaSession> {
  return read<RemoteMediaSession>('/media-sessions/summary', { pointId })
}

export function saveSessionVideo(input: {
  mediaId: string
  pointId: string
  metadata: Record<string, unknown>
}): Promise<RemoteVideo> {
  return command<RemoteVideo>('/media-sessions/videos', {
    body: input,
    key: `video|${input.mediaId}|${input.pointId}`,
  }).then((result) => result.data)
}

export function saveVideoAnalysis(input: {
  videoId: string
  analysis: Record<string, unknown>
}): Promise<RemoteVideo> {
  return command<RemoteVideo>(`/media-sessions/videos/${encodeURIComponent(input.videoId)}/analysis`, {
    body: { analysis: input.analysis },
    key: `video-analysis|${input.videoId}`,
  }).then((result) => result.data)
}

export function saveSessionComparison(input: {
  pointId: string
  beforeId: string
  afterId: string
  result: Record<string, unknown>
}): Promise<RemoteComparison> {
  return command<RemoteComparison>('/media-sessions/comparisons', {
    body: input,
    key: `compare|${input.beforeId}|${input.afterId}|${input.pointId}`,
  }).then((result) => result.data)
}
