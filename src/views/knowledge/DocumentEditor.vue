<script setup lang="ts">
import { ref, watch } from 'vue'
import { knowledgeWrite } from '@/api/knowledge/client'
import type { KnowledgeDocument } from '@/api/knowledge/types'
const props = defineProps<{ document: KnowledgeDocument | null; canMaintain: boolean }>()
const emit = defineEmits<{ saved: []; cancel: [] }>()
const title = ref(''), sourcePath = ref(''), sourceKind = ref('project'), content = ref('')
const roles = ref<string[]>([]), busy = ref(false), error = ref('')
const options = [['safety', '安全管理'], ['property', '物业值班'], ['device', '设备管理'], ['inspector', '巡检'], ['repair', '维修']]
watch(() => props.document, doc => {
  title.value = doc?.title ?? ''; sourcePath.value = doc?.sourcePath ?? ''
  sourceKind.value = doc?.sourceKind ?? 'project'; content.value = doc?.content ?? ''
  roles.value = doc?.roles.slice() ?? options.map(row => row[0]!); error.value = ''
}, { immediate: true })
async function importFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  if (file.size > 160000) { error.value = '文件过大，请使用 160 KB 以内的 Markdown 或文本文件'; return }
  content.value = await file.text()
  if (!sourcePath.value) sourcePath.value = file.name
  input.value = ''
}
async function save() {
  if (roles.value.length === 0) { error.value = '至少选择一种适用身份'; return }
  busy.value = true; error.value = ''
  const doc = props.document
  const payload = doc ? { expectedRev: doc.rev, content: content.value, title: title.value, roles: roles.value }
    : { title: title.value, sourcePath: sourcePath.value, sourceKind: sourceKind.value, content: content.value, roles: roles.value }
  try {
    await knowledgeWrite(doc ? `/documents/${doc.id}/versions` : '/documents', payload, crypto.randomUUID())
    emit('saved')
  } catch (cause) { error.value = String(cause) }
  finally { busy.value = false }
}
</script>
<template>
  <section class="knowledge-panel">
    <h2>{{ document ? `${document.title} · V${document.version}` : '新增知识文档' }}</h2>
    <form class="knowledge-form" @submit.prevent="save">
      <fieldset :disabled="!canMaintain || busy">
        <label>标题<input v-model="title" required maxlength="120"></label>
        <label>来源路径<input v-model="sourcePath" required maxlength="500" :readonly="!!document"></label>
        <label>来源标识<select v-model="sourceKind" :disabled="!!document"><option value="project">项目知识</option><option value="demo">演示规则</option><option value="reference">公开参考</option></select></label>
        <label>导入 Markdown / 文本<input type="file" accept=".md,.txt,text/plain,text/markdown" @change="importFile"></label>
        <label>原文<textarea v-model="content" required maxlength="40000" rows="10"></textarea></label>
        <p>来源路径仅用于引用定位，不会读取该路径。保存修改会新增版本，旧版保留。</p>
        <div class="knowledge-roles"><label v-for="role in options" :key="role[0]"><input v-model="roles" type="checkbox" :value="role[0]">{{ role[1] }}</label></div>
        <button>{{ busy ? '保存中…' : document ? '保存为新版本' : '创建文档' }}</button>
      </fieldset>
      <p v-if="error" role="alert">{{ error }}</p>
      <button type="button" @click="emit('cancel')">收起文档</button>
    </form>
    <p v-if="document" class="knowledge-meta">当前 SHA-256：{{ document.sha256 }}；已保留 {{ document.versions.length }} 个版本。</p>
  </section>
</template>
