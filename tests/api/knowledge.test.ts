import { beforeEach, expect, it, vi } from 'vitest'

const { command, read } = vi.hoisted(() => ({ command: vi.fn(), read: vi.fn() }))
vi.mock('@/api/backend/runtime', () => ({ command, read }))
import { knowledgeRead, knowledgeWrite, knowledgeSearch } from '@/api/knowledge/client'

beforeEach(() => {
  command.mockReset().mockResolvedValue({ data: { built: false, error: '模型缺失' } })
  read.mockReset().mockResolvedValue([])
})

it('preserves explicit failed builds and the caller retry key', async () => {
  const result = await knowledgeWrite('/indexes/rebuild', {}, 'operation-1')
  expect(result).toEqual({ built: false, error: '模型缺失' })
  expect(command).toHaveBeenCalledWith('/knowledge/indexes/rebuild', { body: {}, key: 'operation-1' })
})

it('sends revision and content unchanged and propagates failures', async () => {
  command.mockRejectedValueOnce(new Error('版本冲突'))
  await expect(knowledgeWrite('/documents/doc/versions', { expectedRev: 2, content: '新原文' }, 'retry'))
    .rejects.toThrow('版本冲突')
  expect(command.mock.calls[0]?.[1].body).toEqual({ expectedRev: 2, content: '新原文' })
})

it('reads server documents and sends a real search request', async () => {
  await knowledgeRead('/documents')
  expect(read).toHaveBeenCalledWith('/knowledge/documents')
  await knowledgeSearch('工单如何验收')
  expect(command.mock.calls[0]?.[0]).toBe('/knowledge/search')
  expect(command.mock.calls[0]?.[1].body).toEqual({ query: '工单如何验收', topK: 3 })
})
