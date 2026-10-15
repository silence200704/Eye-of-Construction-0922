<script setup lang="ts">
import { onMounted, ref, nextTick, watch } from 'vue'
import { useLegacyMigrationStore } from '@/stores/backend/migration'
import { demoActivity } from '@/core/demo/workspace'
import SectionCard from '@/components/ui/SectionCard.vue'
import AppButton from '@/components/ui/AppButton.vue'

const migration = useLegacyMigrationStore()
const feedback = ref<HTMLElement | null>(null)
async function importFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  if (input.files?.[0]) await migration.importFile(input.files[0])
  input.value = ''
}
watch(() => migration.busy, async (busy, wasBusy) => {
  if (!busy && wasBusy && migration.results.some(row => row.status === 'blocked')) {
    await nextTick()
    feedback.value?.focus()
  }
})
onMounted(migration.loadHistory)
</script>

<template>
  <SectionCard title="旧数据迁移" sub="迁移本浏览器的主库、完整演示库、当前临时数据及随包素材" marked>
    <p class="hint">数据按测试集导入 SQLite，保留原编号、时间、来源和历史人员。相同快照重复导入会复用，冲突会报告；浏览器原数据不会清空。当前业务页面将在后续阶段逐项切换到服务端。</p>
    <p v-if="!migration.canImport" class="notice notice--warn">请切换到学校安全管理身份后执行导入。</p>
    <div class="row wrap">
      <AppButton variant="primary" :disabled="migration.busy || demoActivity || !migration.canImport" @click="migration.runLocal">检查并导入本机旧数据</AppButton>
      <AppButton :disabled="migration.busy || demoActivity" @click="migration.exportLocal">导出迁移快照</AppButton>
      <label class="migration-upload">导入旧 JSON 备份<input type="file" accept="application/json,.json" :disabled="migration.busy || demoActivity || !migration.canImport" @change="importFile" /></label>
      <AppButton :disabled="migration.busy || !migration.canImport" @click="migration.loadHistory">读取导入记录</AppButton>
      <AppButton v-if="migration.results.length" :disabled="migration.busy" @click="migration.exportReport">导出核对报告</AppButton>
    </div>
    <p ref="feedback" tabindex="-1" role="status" aria-live="polite">{{ migration.message }}</p>
    <article v-for="(result, index) in migration.results" :key="`${result.sourceName}-${index}`" class="migration-result">
      <h3>{{ result.sourceName }} → {{ result.datasetId }} · {{ result.status === 'imported' ? (result.report.replayed ? '已复用' : '已导入并核对') : '未提交' }}</h3>
      <p class="muted">原字段核对 {{ result.report.fieldsVerified }} 项，文件校验 {{ result.report.filesVerified }} 个</p>
      <div class="migration-table">
        <table><caption class="sr-only">{{ result.sourceName }} 逐表数量核对</caption>
          <thead><tr><th>原表</th><th>来源数量</th><th>新增</th><th>复用</th></tr></thead>
          <tbody><tr v-for="(counts, table) in result.report.tables" :key="table"><th scope="row">{{ table }}</th><td>{{ counts.source }}</td><td>{{ counts.inserted }}</td><td>{{ counts.matched }}</td></tr></tbody>
        </table>
      </div>
      <ul v-if="result.report.errors.length" role="alert"><li v-for="(problem, problemIndex) in result.report.errors" :key="problemIndex">{{ problem.table }} / {{ problem.id || '整包' }}：{{ problem.message }}</li></ul>
      <ul v-if="result.report.warnings.length"><li v-for="(warning, warningIndex) in result.report.warnings" :key="warningIndex">提示：{{ warning.message }}</li></ul>
    </article>
  </SectionCard>
</template>

<style scoped>
.migration-upload { display: grid; gap: 6px; font-size: 13px; }
.migration-result { margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--line); }
.migration-result h3 { font-size: 15px; margin: 0 0 8px; overflow-wrap: anywhere; }
.migration-table { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 12px; text-align: left; }
th, td { padding: 8px 10px; border-bottom: 1px solid var(--line); }
thead { background: var(--surface-soft, #f3f6f5); }
ul { padding-left: 20px; overflow-wrap: anywhere; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
</style>
