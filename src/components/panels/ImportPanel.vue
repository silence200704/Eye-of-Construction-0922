<script setup lang="ts">
/**
 * CSV 批量导入面板。
 *
 * 上传文件与粘贴文本两种入口，解析后先出预览：逐行标注通过 / 警告 / 错误与原因。
 * 错误行只在预览里提示，不写入正式数据；确认导入时逐条走与手工录入相同的链路。
 */
import { computed, ref } from 'vue'
import { useArchiveStore } from '@/stores/archive'
import { useRecordsStore } from '@/stores/records'
import { useAlertStore } from '@/stores/alerts'
import { buildTemplate, templateHint } from '@/config/csvTemplate'
import { hasNumericReadings, pointTypeDef } from '@/types/catalog'
import { previewFromText, type ImportPreview } from '@/core/csv'
import { runImport, type ImportResult } from '@/stores/writes/importWrites'
import SectionCard from '@/components/ui/SectionCard.vue'
import DataTable from '@/components/ui/DataTable.vue'
import AppButton from '@/components/ui/AppButton.vue'
import StatusTag from '@/components/ui/StatusTag.vue'

const archive = useArchiveStore()
const records = useRecordsStore()
const alerts = useAlertStore()

const text = ref('')
const preview = ref<ImportPreview | null>(null)
const result = ref<ImportResult | null>(null)
const message = ref('')
const tone = ref<'ok' | 'bad'>('ok')
const fileName = ref('')

const importable = computed(() => (preview.value === null ? 0 : preview.value.okCount + preview.value.warnCount))

function parse(): void {
  result.value = null
  if (text.value.trim() === '') {
    tone.value = 'bad'
    message.value = '请先上传文件或粘贴 CSV 内容'
    preview.value = null
    return
  }
  preview.value = previewFromText(text.value, {
    points: archive.points,
    rules: archive.rules,
    existing: records.records,
  })
  tone.value = preview.value.errorCount > 0 ? 'bad' : 'ok'
  message.value =
    preview.value.headerOk === false
      ? `表头缺少必需列：${preview.value.headerMissing.join('、')}`
      : `解析完成：可导入 ${importable.value} 行，错误 ${preview.value.errorCount} 行`
}

async function onFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file === undefined) return
  fileName.value = file.name
  text.value = await file.text()
  parse()
}

function downloadTemplate(): void {
  // 人工检查点没有数值字段，导入也会被拒；模板必须取一个能数值导入的测点
  const point = archive.activePoints.find((row) => hasNumericReadings(row.metric))
  if (point === undefined) {
    tone.value = 'bad'
    message.value = '档案里还没有可数值导入的测点（人工检查点不接受数值导入），无法生成模板'
    return
  }
  const blob = new Blob(['\uFEFF' + buildTemplate(point.code, point.type)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `zhutong-import-template-${point.code}.csv`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
  tone.value = 'ok'
  message.value = `已下载模板（示例测点 ${point.code} ${pointTypeDef(point.type).name}），可直接另存为 CSV 后使用`
}

async function confirmImport(): Promise<void> {
  if (preview.value === null) return
  result.value = await runImport(preview.value, { fileName: fileName.value === '' ? '粘贴文本' : fileName.value })
  alerts.enqueueBatch(result.value.alertInputs)
  // 条数与事件处置在下方"导入结果"里已经写全，这里不再重复一遍
  message.value = ''
  preview.value = null
  text.value = ''
  fileName.value = ''
}

function statusOf(row: { status: string }): { tone: 'green' | 'orange' | 'red'; text: string } {
  if (row.status === 'ok') return { tone: 'green', text: '通过' }
  if (row.status === 'warn') return { tone: 'orange', text: '警告' }
  return { tone: 'red', text: '错误' }
}
</script>

<template>
  <SectionCard
    title="CSV 批量导入"
    sub="用于批量模拟传感器数据；错误行只在预览中提示，不写入正式数据"
    marked
  >
    <p class="notice notice--warn">
      导入确认后逐条调用与手工录入相同的录入链路，因此基准快照、规则判定、事件去重升级与通知完全一致。
      请先准备档案里的测点编号，再从模板开始填。
    </p>

    <div class="row wrap actions">
      <label class="upload">
        <input type="file" accept=".csv,text/csv" @change="onFile" />
        <span class="upload-btn">上传 CSV 文件</span>
      </label>
      <AppButton size="sm" @click="downloadTemplate">下载模板</AppButton>
      <AppButton size="sm" variant="primary" :disabled="text.trim() === ''" @click="parse">解析并预览</AppButton>
      <span v-if="fileName !== ''" class="muted">{{ fileName }}</span>
    </div>

    <label class="paste">
      <span>或直接粘贴 CSV 内容</span>
      <textarea
        v-model="text"
        class="ctl"
        rows="5"
        placeholder="测点编号,采样时间,裂缝宽度,单位,质量标记,备注&#10;B03-F2-CRACK01,2026-09-20 09:00,0.62,mm,有效,现场量测"
      />
    </label>

    <p class="field-hint">{{ templateHint() }}</p>

    <p v-if="message !== ''" class="notice" :class="tone === 'ok' ? 'notice--brand' : 'notice--warn'">{{ message }}</p>

    <template v-if="preview !== null">
      <div class="summary">
        <StatusTag tone="green" :text="`通过 ${preview.okCount}`" />
        <StatusTag tone="orange" :text="`警告 ${preview.warnCount}`" />
        <StatusTag tone="red" :text="`错误 ${preview.errorCount}`" />
      </div>

      <DataTable
        :columns="[
          { key: 'line', label: '行号', width: '62px' },
          { key: 'summary', label: '测点与采样时间' },
          { key: 'status', label: '校验', width: '86px' },
          { key: 'messages', label: '说明' },
        ]"
        :row-count="preview.rows.length"
        empty="文件里没有数据行"
      >
        <tr v-for="row in preview.rows" :key="row.lineNo">
          <td class="num">{{ row.lineNo }}</td>
          <td class="code">{{ row.summary }}</td>
          <td><StatusTag :tone="statusOf(row).tone" :text="statusOf(row).text" /></td>
          <td class="muted">{{ row.messages.length === 0 ? '—' : row.messages.join('；') }}</td>
        </tr>
      </DataTable>

      <div class="row-between foot">
        <span class="muted">错误行不会被写入；确认导入后逐条走正式判定链路。</span>
        <AppButton
          variant="primary"
          :disabled="importable === 0"
          @click="confirmImport"
        >
          确认导入 {{ importable }} 行
        </AppButton>
      </div>
    </template>

    <div v-if="result !== null" class="notice notice--brand">
      <div class="row wrap">
        <b>导入结果：</b>
        <span>写入 {{ result.imported }} 条</span>
        <span class="muted">跳过错误行 {{ result.skipped }} 条</span>
      </div>
      <p v-if="result.eventMessages.length > 0" class="field-hint">
        触发的预警事件：{{ result.eventMessages.join('；') }}。本批次已汇总到右上角「预警提醒」，不会逐条弹窗打断导入。
      </p>
    </div>
  </SectionCard>
</template>

<style scoped>
.actions {
  margin-bottom: 14px;
}

.upload input {
  display: none;
}

.upload-btn {
  display: inline-flex;
  align-items: center;
  height: var(--h-control-sm);
  padding: 0 10px;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-sm);
  background: var(--paper);
  font-size: 12.5px;
  cursor: pointer;
}

.upload-btn:hover {
  border-color: var(--brand-500);
  color: var(--brand-700);
}

.paste {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12px;
  color: var(--text-2);
  margin-bottom: 10px;
}

.paste textarea {
  font-family: var(--font-mono);
  font-size: 12.5px;
}

.summary {
  display: flex;
  gap: 10px;
  margin: 14px 0 10px;
}

.foot {
  margin-top: 12px;
}

.notice {
  margin-bottom: 12px;
}
</style>
