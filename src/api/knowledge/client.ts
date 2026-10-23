import { command, read } from '@/api/backend/runtime'
import type { SearchResult } from './types'

export function knowledgeRead<T>(suffix: string): Promise<T> {
  return read<T>(`/knowledge${suffix}`)
}

export async function knowledgeWrite<T>(suffix: string, body: unknown, key: string): Promise<T> {
  return (await command<T>(`/knowledge${suffix}`, { body, key })).data
}

export function knowledgeSearch(query: string): Promise<SearchResult> {
  return knowledgeWrite<SearchResult>('/search', { query, topK: 3 }, crypto.randomUUID())
}
