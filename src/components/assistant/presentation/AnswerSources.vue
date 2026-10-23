<script setup lang="ts">
/**
 * 来源分列：业务事实（服务端数据库，本次查询）与知识依据（本地知识库，带版本/行号）。
 * 引用必须能打开核对原文；版本或哈希不一致时不展示旧文，避免把更新后的文档当依据。
 */
import { computed, reactive } from 'vue'
import { formatDateTime } from '@/core/time'
import { loadCitation, type CitationView } from '@/assistant/remote/citations'
import type { AskCitation, AskResult } from '@/assistant/types'

const props = defineProps<{ result: AskResult }>()

const open = reactive<Record<string, boolean>>({})
const views = reactive<Record<string, CitationView | null>>({})
const loading = reactive<Record<string, boolean>>({})

const citations = computed<AskCitation[]>(() => props.result.citations ?? [])
const knowledge = computed(() => props.result.knowledge ?? null)
const sources = computed(() => props.result.sources ?? null)
const decisionText = computed(() => {
  const decision = knowledge.value?.decision
  if (decision === 'answer') return '知识库已命中'
  if (decision === 'clarify') return '知识依据需要补充对象后再确认'
  if (decision === 'no_basis') return '本地知识库没有足够依据'
  if (decision === 'unavailable') return '本地知识检索不可用'
  return ''
})

async function toggle(citation: AskCitation): Promise<void> {
  const key = citation.chunkId
  if (open[key] === true) {
    open[key] = false
    return
  }
  open[key] = true
  if (views[key] !== undefined && views[key] !== null) return
  loading[key] = true
  try {
    views[key] = await loadCitation(citation)
  } catch (cause) {
    views[key] = {
      text: '',
      available: false,
      note: `引用读取失败：${cause instanceof Error ? cause.message : String(cause)}`,
    }
  } finally {
    loading[key] = false
  }
}
</script>

<template>
  <div class="block sources reveal-part">
    <p class="block-title">来源（业务事实与知识依据分开）</p>
    <p v-if="sources !== null" class="line">
      业务事实：{{ sources.facts === 'server_db' ? '服务端数据库本次查询' : '本次回答没有可绑定的业务数据' }}
      <span v-if="sources.facts === 'server_db'">· 查询于 {{ formatDateTime(sources.queriedAt) }}</span>
    </p>
    <p v-if="knowledge !== null" class="line">
      知识依据：{{ decisionText }}
      <span v-if="knowledge.mode !== '' && knowledge.mode !== 'none'">· 检索方式 {{ knowledge.mode === 'hybrid' ? '本地混合检索' : '本地关键词检索' }}</span>
      <span v-if="knowledge.indexVersion">· 索引 {{ knowledge.indexVersion }}</span>
    </p>
    <p v-if="knowledge?.reason" class="hint">{{ knowledge.reason }}</p>
    <p v-if="knowledge?.excerpt && result.intent !== 'knowledge'" class="excerpt">{{ knowledge.excerpt }}</p>

    <ul v-if="citations.length > 0" class="citations">
      <li v-for="citation in citations" :key="citation.chunkId">
        <button type="button" class="citation" :aria-expanded="open[citation.chunkId] === true" @click="toggle(citation)">
          <b>{{ citation.title }}</b>
          <span class="meta">v{{ citation.version }} · {{ citation.sourcePath }} 第 {{ citation.lineStart }}–{{ citation.lineEnd }} 行 · {{ citation.methods.join(' / ') }}</span>
          <span class="toggle">{{ open[citation.chunkId] === true ? '收起' : '查看引用' }}</span>
        </button>
        <div v-if="open[citation.chunkId] === true" class="citation-body">
          <p v-if="loading[citation.chunkId] === true" class="hint">正在读取引用原文…</p>
          <template v-else-if="views[citation.chunkId]">
            <p v-if="views[citation.chunkId]!.available" class="text">{{ views[citation.chunkId]!.text }}</p>
            <p class="hint">{{ views[citation.chunkId]!.note }}</p>
          </template>
        </div>
      </li>
    </ul>
    <p v-else-if="knowledge !== null" class="hint">没有可展开的引用；本回答不把没有依据的内容写成结论。</p>
  </div>
</template>

<style scoped>
.block { display: grid; gap: 5px; }
.block-title { margin: 0; color: var(--text-2); font-size: 11.5px; font-weight: 700; }
.line { margin: 0; color: var(--text); font-size: 12px; line-height: 1.6; }
.hint { margin: 0; color: var(--text-3); font-size: 11.5px; line-height: 1.5; }
.excerpt { margin: 0; padding: 8px 10px; border-left: 2px solid var(--brand-300, var(--brand-200)); color: var(--text-2); font-size: 12px; line-height: 1.6; }
.citations { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
.citation {
  display: grid;
  gap: 2px;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--paper);
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.citation:hover, .citation:focus-visible { border-color: var(--brand-500); }
.citation b { font-size: 12px; }
.meta { color: var(--text-3); font-size: 11px; }
.toggle { color: var(--brand-700); font-size: 11px; }
.citation-body { padding: 8px 10px; border: 1px dashed var(--line-strong); border-radius: var(--r-sm); }
.text { margin: 0 0 4px; white-space: pre-wrap; font-size: 12px; line-height: 1.7; color: var(--text); }
</style>
