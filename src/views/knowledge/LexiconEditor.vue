<script setup lang="ts">
import { computed, ref } from 'vue'
import { knowledgeWrite } from '@/api/knowledge/client'
import type { KnowledgeDocument, LexiconRow } from '@/api/knowledge/types'
const props = defineProps<{ documents: KnowledgeDocument[]; faqs: LexiconRow[]; synonyms: LexiconRow[] }>()
const emit = defineEmits<{ saved: [] }>()
const kind = ref<'faqs' | 'synonyms'>('faqs'), selected = ref<LexiconRow | null>(null)
const chunkId = ref(''), canonical = ref(''), lines = ref(''), enabled = ref(true), busy = ref(false), error = ref('')
const rows = computed(() => kind.value === 'faqs' ? props.faqs : props.synonyms)
function edit(row: LexiconRow | null) {
  selected.value = row; chunkId.value = row?.chunkId ?? ''; canonical.value = row?.canonical ?? ''
  lines.value = (row?.questions ?? row?.aliases ?? []).join('\n'); enabled.value = row?.enabled ?? true; error.value = ''
}
async function save() {
  const values = lines.value.split('\n').map(text => text.trim()).filter(Boolean)
  if (values.length === 0) { error.value = '请至少填写一行有效问法或别名'; return }
  busy.value = true; error.value = ''
  const row = selected.value
  const payload = { ...(row ? { id: row.id, expectedRev: row.rev } : {}), enabled: enabled.value,
    ...(kind.value === 'faqs' ? { chunkId: chunkId.value, questions: values } : { canonical: canonical.value, aliases: values }) }
  try { await knowledgeWrite(`/${kind.value}`, payload, crypto.randomUUID()); edit(null); emit('saved') }
  catch (cause) { error.value = String(cause) }
  finally { busy.value = false }
}
</script>
<template>
  <section class="knowledge-panel">
    <h2>FAQ 与同义词</h2>
    <label>维护类型<select v-model="kind" :disabled="busy" @change="edit(null)"><option value="faqs">标准问法</option><option value="synonyms">术语同义词</option></select></label>
    <ul class="knowledge-list"><li v-for="row in rows" :key="row.id"><button :disabled="busy" @click="edit(row)">{{ row.canonical ?? row.questions?.[0] }} · {{ row.enabled ? '启用' : '停用' }}</button></li></ul>
    <button :disabled="busy" @click="edit(null)">新增{{ kind === 'faqs' ? '标准问法' : '同义词' }}</button>
    <form class="knowledge-form" @submit.prevent="save">
      <fieldset :disabled="busy">
        <label v-if="kind === 'faqs'">绑定当前依据块<select v-model="chunkId" required><option value="" disabled>选择文档与原文块</option><optgroup v-for="doc in documents" :key="doc.id" :label="`${doc.title} V${doc.version}${doc.enabled ? '' : '（停用）'}`"><option v-for="chunk in doc.chunks" :key="chunk.id" :value="chunk.id">{{ chunk.heading }} · 第 {{ chunk.lineStart }} 行</option></optgroup></select></label>
        <label v-else>规范术语<input v-model="canonical" required maxlength="40"></label>
        <label>{{ kind === 'faqs' ? '标准问法，每行一条（最多 20 条）' : '别名，每行一条（最多 20 条）' }}<textarea v-model="lines" required rows="3" maxlength="4000"></textarea></label>
        <label><input v-model="enabled" type="checkbox">启用</label>
        <p>FAQ 绑定具体版本的依据块。文档更新后请重新核对绑定，旧版本 FAQ 不参与召回。</p>
        <button>{{ busy ? '保存中…' : selected ? '保存修改' : '新增' }}</button>
      </fieldset>
      <p v-if="error" role="alert">{{ error }}</p>
    </form>
  </section>
</template>
