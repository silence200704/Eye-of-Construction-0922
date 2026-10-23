/** 打开知识引用：按文档 ID 读取当前版本，核对引用版本后再显示原文。 */
import { knowledgeRead } from '@/api/knowledge/client'
import type { AskCitation } from '../types'

interface KnowledgeChunk {
  id: string
  heading: string
  text: string
  lineStart: number
  lineEnd: number
  sha256: string
}

interface KnowledgeDocument {
  id: string
  title: string
  version: number
  sha256: string
  sourcePath: string
  chunks: KnowledgeChunk[]
}

export interface CitationView {
  text: string
  note: string
  available: boolean
}

export async function loadCitation(citation: AskCitation): Promise<CitationView> {
  const doc = await knowledgeRead<KnowledgeDocument>(`/documents/${encodeURIComponent(citation.documentId)}`)
  if (doc.version !== citation.version) {
    return {
      text: '',
      available: false,
      note: `引用是 v${citation.version}，当前文档已更新到 v${doc.version}；不把新版本当旧引用展示，请重新提问获取现行依据。`,
    }
  }
  const chunk = doc.chunks.find((row) => row.id === citation.chunkId)
  if (chunk === undefined) {
    return {
      text: '',
      available: false,
      note: `当前版本里找不到引用片段 ${citation.chunkId}；请重新提问核对。`,
    }
  }
  if (chunk.sha256 !== citation.sha256) {
    return {
      text: '',
      available: false,
      note: '引用片段哈希与当前文档不一致，未展示原文；请重新提问。',
    }
  }
  return {
    text: chunk.text,
    available: true,
    note: `${doc.title} v${doc.version} · ${doc.sourcePath} 第 ${chunk.lineStart}–${chunk.lineEnd} 行`,
  }
}
