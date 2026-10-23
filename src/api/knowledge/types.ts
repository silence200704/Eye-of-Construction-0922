export interface KnowledgeChunk {
  id: string; heading: string; text: string; lineStart: number; lineEnd: number; sha256: string
}
export interface KnowledgeDocument {
  id: string; title: string; sourcePath: string; sourceKind: string; version: number; rev: number
  enabled: boolean; roles: string[]; content: string; chunks: KnowledgeChunk[]; sha256: string
  versions: { version: number; sha256: string; createdAt: string }[]
}
export interface KnowledgeStatus {
  mode: 'hybrid' | 'keyword'; activeIndexId: string | null; chunkCount: number
  degradedReason: string; lastError: string; modelId?: string; dimension?: number
}
export interface KnowledgeCandidate {
  documentId: string; chunkId: string; title: string; heading: string; text: string; version: number
  sourcePath: string; sourceKind: string; lineStart: number; lineEnd: number; sha256: string
  methods: string[]; relevance: number
}
export interface SearchResult {
  decision: 'answer' | 'clarify' | 'no_basis'; reason: string; answer: string
  mode: string; degradedReason: string; indexVersion: string | null; elapsedMs: number
  candidates: KnowledgeCandidate[]
}
export interface LexiconRow {
  id: string; rev: number; enabled: boolean; chunkId?: string; questions?: string[]
  canonical?: string; aliases?: string[]
}
