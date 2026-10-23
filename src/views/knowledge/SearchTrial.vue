<script setup lang="ts">
import { ref } from 'vue'
import { knowledgeSearch } from '@/api/knowledge/client'
import type { SearchResult } from '@/api/knowledge/types'
const query = ref('')
const result = ref<SearchResult | null>(null)
const busy = ref(false)
const error = ref('')
let generation = 0
async function search() {
  const ticket = ++generation
  busy.value = true; error.value = ''; result.value = null
  try { const response = await knowledgeSearch(query.value); if (ticket === generation) result.value = response }
  catch (cause) { if (ticket === generation) error.value = String(cause) }
  finally { if (ticket === generation) busy.value = false }
}
</script>

<template>
  <section class="knowledge-panel" aria-labelledby="trial-title">
    <h2 id="trial-title">检索试用</h2>
    <p>查询当前启用知识，返回原文依据。此入口尚未接入小瞳会话。</p>
    <form class="knowledge-form" @submit.prevent="search">
      <label for="knowledge-query">知识问题</label>
      <input id="knowledge-query" v-model="query" required maxlength="500" placeholder="例如：维修工单如何验收？">
      <button :disabled="busy">{{ busy ? '正在检索…' : '检索依据' }}</button>
      <p v-if="error" role="alert">{{ error }}</p>
    </form>
    <div v-if="result" aria-live="polite">
      <h3>{{ { answer: '找到知识依据', clarify: '需要补充对象', no_basis: '没有充分依据' }[result.decision] }}</h3>
      <p>{{ result.reason }}</p>
      <p>{{ result.mode === 'hybrid' ? 'FAQ / 关键词 / 本地向量' : 'FAQ / 关键词降级' }} · {{ result.elapsedMs }} ms</p>
      <p v-if="result.degradedReason" class="knowledge-warning">{{ result.degradedReason }}</p>
      <p class="knowledge-meta">索引版本：{{ result.indexVersion ?? '无可用向量索引' }}；相关度是排序分值，不是可信概率。</p>
      <article v-for="row in result.candidates" :key="row.chunkId" class="knowledge-citation">
        <h3>{{ row.heading }} · V{{ row.version }}</h3>
        <p class="knowledge-excerpt">{{ row.text }}</p>
        <p class="knowledge-meta">{{ row.sourcePath }} · 第 {{ row.lineStart }}—{{ row.lineEnd }} 行 · {{ row.sourceKind === 'demo' ? '演示规则' : '项目知识' }}</p>
        <p class="knowledge-meta">命中：{{ row.methods.join(' / ') }} · 相关度 {{ row.relevance }}</p>
        <details><summary>引用校验信息</summary><p class="knowledge-meta">块 {{ row.chunkId }}<br>SHA-256 {{ row.sha256 }}</p></details>
      </article>
    </div>
  </section>
</template>
