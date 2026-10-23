<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { backendEnabled } from '@/api/http/runtime'
import { useBackendSessionStore } from '@/stores/backend/session'
import { knowledgeRead, knowledgeWrite } from '@/api/knowledge/client'
import type { KnowledgeDocument, KnowledgeStatus, LexiconRow } from '@/api/knowledge/types'
import SearchTrial from './SearchTrial.vue'
import DocumentEditor from './DocumentEditor.vue'
import LexiconEditor from './LexiconEditor.vue'
import './knowledge.css'

const session = useBackendSessionStore()
const canMaintain = computed(() => session.user?.role === 'safety' && session.user?.buildingIds === null)
const documents = ref<KnowledgeDocument[]>([]), faqs = ref<LexiconRow[]>([]), synonyms = ref<LexiconRow[]>([])
const status = ref<KnowledgeStatus | null>(null), selected = ref<KnowledgeDocument | null>(null)
const editor = ref(false), busy = ref(false), error = ref(''), message = ref('')
let generation = 0
async function load() {
  const ticket = ++generation
  busy.value = true; error.value = ''; selected.value = null; editor.value = false
  documents.value = []; faqs.value = []; synonyms.value = []; status.value = null
  try {
    const [docs, state, faqRows, synonymRows] = await Promise.all([
      knowledgeRead<KnowledgeDocument[]>('/documents'), knowledgeRead<KnowledgeStatus>('/status'),
      canMaintain.value ? knowledgeRead<LexiconRow[]>('/faqs') : [],
      canMaintain.value ? knowledgeRead<LexiconRow[]>('/synonyms') : [],
    ])
    if (ticket !== generation) return
    documents.value = docs; status.value = state; faqs.value = faqRows; synonyms.value = synonymRows
  } catch (cause) { if (ticket === generation) error.value = String(cause) }
  finally { if (ticket === generation) busy.value = false }
}
async function rebuild() {
  busy.value = true; error.value = ''; message.value = ''
  try {
    const result = await knowledgeWrite<{ built: boolean; error: string }>('/indexes/rebuild', {}, crypto.randomUUID())
    message.value = result.built ? '索引已完整构建并发布' : `构建失败，保留原索引：${result.error}`
    await load()
  } catch (cause) { error.value = String(cause) }
  finally { busy.value = false }
}
async function toggle(doc: KnowledgeDocument) {
  busy.value = true; error.value = ''
  try {
    await knowledgeWrite(`/documents/${doc.id}/enabled`, { expectedRev: doc.rev, enabled: !doc.enabled }, crypto.randomUUID())
    await load()
  } catch (cause) { error.value = String(cause) }
  finally { busy.value = false }
}
watch(() => session.user?.id, () => { message.value = ''; if (backendEnabled && session.user) void load() })
onMounted(() => { if (backendEnabled && session.user) void load() })
</script>

<template>
  <div class="knowledge-page">
    <header class="knowledge-heading"><div><p class="knowledge-eyebrow">项目知识 / 本地检索</p><h1>知识库</h1><p>操作流程、身份职责与演示规则；以可定位原文作为回答依据。</p></div><button v-if="backendEnabled" :disabled="busy" @click="load">刷新服务端状态</button></header>
    <p v-if="!backendEnabled" class="knowledge-warning">知识库需要启用后端数据模式。</p>
    <template v-else>
      <p v-if="error" role="alert">{{ error }}</p><p v-if="message" role="status">{{ message }}</p>
      <section class="knowledge-panel" aria-live="polite">
        <h2>{{ !status ? '索引状态尚未读取' : status.mode === 'hybrid' ? '本地向量索引可用' : 'FAQ / 关键词模式' }}</h2>
        <p v-if="busy">正在读取或处理，请稍候…</p>
        <template v-if="status"><p>{{ status.chunkCount }} 个当前原文块 · 通用知识供各业务数据集共用</p><p class="knowledge-meta">{{ status.modelId }} {{ status.dimension ? `· ${status.dimension} 维` : '' }} · 索引 {{ status.activeIndexId ?? '未发布' }}</p><p v-if="status.degradedReason" class="knowledge-warning">{{ status.degradedReason }}</p><p v-if="status.lastError" role="alert">最近构建错误：{{ status.lastError }}</p></template>
        <button v-if="canMaintain" :disabled="busy" @click="rebuild">重建并发布本地索引</button>
        <p>文档或模型变更后需重建索引。缺失、过期或损坏时会明确降级。</p>
      </section>
      <div class="knowledge-columns">
        <div>
          <section class="knowledge-panel"><h2>知识文档 · {{ documents.length }}</h2><p v-if="!canMaintain">当前身份可查阅适用知识；维护限全局安全管理身份。</p><button v-if="canMaintain" :disabled="busy" @click="selected = null; editor = true">新增 / 导入文档</button>
            <ul class="knowledge-list"><li v-for="doc in documents" :key="doc.id"><div><button :disabled="busy" @click="selected = doc; editor = true">{{ doc.title }} · V{{ doc.version }}</button><span>{{ doc.enabled ? '启用' : '停用' }}</span></div><p class="knowledge-meta">{{ doc.sourcePath }}</p><button v-if="canMaintain" :disabled="busy" @click="toggle(doc)">{{ doc.enabled ? '停用文档' : '启用文档' }}</button></li></ul>
            <p v-if="!documents.length && !busy">暂无适用于当前身份的文档。</p>
          </section>
          <DocumentEditor v-if="editor" :key="`${session.user?.id}-${selected?.id ?? 'new'}`" :document="selected" :can-maintain="canMaintain" @saved="load" @cancel="editor = false" />
          <LexiconEditor v-if="canMaintain && !busy" :documents="documents" :faqs="faqs" :synonyms="synonyms" @saved="load" />
        </div>
        <SearchTrial :key="`${session.user?.id}-${generation}`" />
      </div>
    </template>
  </div>
</template>
