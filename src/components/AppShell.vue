<script setup lang="ts">
/** 应用外壳：左侧导航 + 顶栏（页面标题、数据模式提示、演示身份切换）。 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { APP_STAGE, APP_VERSION, DEMO_ROLES, ROLES } from '@/types/catalog'
import { useArchiveStore } from '@/stores/archive'
import { listenExternalChange } from '@/db/tabSync'
import { useSessionStore } from '@/stores/session'
import AppModal from '@/components/ui/AppModal.vue'
import AppButton from '@/components/ui/AppButton.vue'
import FormGrid from '@/components/ui/FormGrid.vue'
import StatusTag from '@/components/ui/StatusTag.vue'
import AlertCenter from '@/components/ui/overlay/AlertCenter.vue'
import AssistantPanel from '@/components/assistant/AssistantPanel.vue'
import NavGroups from '@/components/shell/NavGroups.vue'
import FeatureLinks from '@/components/shell/FeatureLinks.vue'
import PageStage from '@/components/shell/PageStage.vue'
import FloatingXiaotong from '@/components/assistant/FloatingXiaotong.vue'
import { useAssistantStore } from '@/assistant/session'
import { useAlertStore } from '@/stores/alerts'
import { isShowcase } from '@/core/demo/workspace'
import ShowcaseControls from '@/components/demo/ShowcaseControls.vue'
import OperationReceipt from '@/components/demo/OperationReceipt.vue'
import { useShowcaseStore } from '@/stores/demo/showcase/session'
const showcase = useShowcaseStore()

const route = useRoute()
const archive = useArchiveStore()
const session = useSessionStore()
const alerts = useAlertStore()
/** 红色预警弹窗出现时，悬浮小瞳的装饰动画要让位 */
const alertStrongVisible = computed(() => alerts.activeStrong !== null)

const pageTitle = computed(() => String(route.meta.title ?? ''))
const pageSub = computed(() => String(route.meta.sub ?? ''))
const mode = computed(() => archive.dataMode)

/**
 * 问筑瞳半屏面板的开关与焦点回位。
 * 入口是可拖动的悬浮小瞳（FloatingXiaotong），面板不做焦点陷阱（桌面端左侧页面仍要能用），
 * 所以"从哪开、回哪去"由壳层负责：关闭后把焦点交回悬浮入口。
 */
const assistant = useAssistantStore()
const floatingEntry = ref<{ focus: () => void } | null>(null)

function closeAssistant(): void {
  assistant.close()
  floatingEntry.value?.focus()
}

const identityOpen = ref(false)

const identityFields = [
  { key: 'name', label: '操作人姓名', type: 'text' as const, required: true, placeholder: '例如 张工' },
  {
    key: 'role',
    label: '演示角色',
    type: 'select' as const,
    required: true,
    options: DEMO_ROLES.map((row) => ({ value: row.key, label: row.name })),
    hint: '角色切换用于区分操作留痕；V0.1 的切换不等于真实鉴权',
  },
]

const identityModel = ref<Record<string, unknown>>({ name: '', role: '' })

function openIdentity(): void {
  identityModel.value = { name: session.name, role: session.role }
  identityOpen.value = true
}

function saveIdentity(): void {
  const name = String(identityModel.value.name ?? '').trim()
  const role = String(identityModel.value.role ?? '')
  if (name === '' || role === '') return
  session.setIdentity(name, role)
  identityOpen.value = false
}

const roleDuty = computed(() => ROLES.find((row) => row.key === identityModel.value.role)?.duty ?? '')

/** 其它标签页写入过数据：提示刷新，避免两个窗口互相覆盖。 */
const externalChange = ref(false)
let stopListening: (() => void) | null = null

onMounted(() => {
  stopListening = listenExternalChange(() => {
    externalChange.value = true
  })
})

onBeforeUnmount(() => {
  stopListening?.()
  stopListening = null
})

function reloadPage(): void {
  window.location.reload()
}
</script>

<template>
  <div class="shell">
    <aside class="side">
      <div class="brand">
        <div class="brand-mark">筑</div>
        <div>
          <div class="brand-name">筑瞳</div>
          <div class="brand-sub">校园建筑健康监测与预警</div>
        </div>
      </div>

      <NavGroups />

      <div class="side-foot">
        <div class="side-note">
          <StatusTag :tone="mode === 'seed' ? 'brand' : 'gray'" :text="mode === 'seed' ? '示例数据模式' : '空白建档模式'" />
        </div>
        <p class="side-note-text">
          数据保存在本机浏览器数据库中，清除浏览器数据会丢失内容，请在设置页定期导出备份。
        </p>
        <p class="side-version">{{ APP_VERSION }} · {{ APP_STAGE }} · 纯前端演示版</p>
      </div>
    </aside>

    <div class="main">
      <header class="top">
        <div>
          <h1 class="page-title">{{ pageTitle }}</h1>
          <p class="page-sub">{{ pageSub }}</p>
        </div>
        <div class="row">
          <div class="stat-mini">
            <span class="muted">在册楼栋</span>
            <b class="num">{{ archive.stats.buildings }}</b>
            <span class="muted">测点</span>
            <b class="num">{{ archive.stats.points }}</b>
            <span class="muted">设备</span>
            <b class="num">{{ archive.stats.devices }}</b>
          </div>
          <AlertCenter />
          <button class="identity" type="button" :disabled="showcase.running" @click="openIdentity">
            <span class="id-avatar">{{ session.name.slice(0, 1) }}</span>
            <span class="id-text">
              <b>{{ session.name }}</b>
              <i>{{ session.roleLabel }}</i>
            </span>
          </button>
        </div>
      </header>

      <NavGroups compact class="mobile-nav" />

      <div v-if="externalChange" class="tab-warning">
        <span>检测到另一个标签页修改了本机数据。本版本不做跨标签页同步，继续在本页操作可能覆盖对方的改动。</span>
        <AppButton size="sm" @click="reloadPage">刷新页面</AppButton>
      </div>

      <main class="content">
        <ShowcaseControls v-if="isShowcase" compact />
        <OperationReceipt />
        <FeatureLinks />
        <div :inert="showcase.running"><PageStage /></div>
      </main>
    </div>

    <FloatingXiaotong
      v-show="!assistant.open"
      ref="floatingEntry"
      :state="assistant.entryState"
      :paused="alertStrongVisible"
      @activate="assistant.toggle()"
    />

    <AssistantPanel :open="assistant.open" @close="closeAssistant" />

    <AppModal :open="identityOpen" title="切换演示身份" sub="操作留痕使用当前身份，请按演示角色切换" :width="520" @close="identityOpen = false">
      <FormGrid v-model="identityModel" :fields="identityFields" :columns="1" />
      <p v-if="roleDuty" class="notice notice--brand duty">职责：{{ roleDuty }}</p>
      <template #footer>
        <AppButton @click="identityOpen = false">取消</AppButton>
        <AppButton variant="primary" @click="saveIdentity">应用身份</AppButton>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.shell {
  display: grid;
  grid-template-columns: var(--sidebar-w) minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  height: 100%;
}

.side {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
  background: var(--ink-900);
  color: #cfd9de;
  padding: 18px 14px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 6px 18px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.brand-mark {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: var(--r-sm);
  background: var(--brand-600);
  color: #fff;
  font-size: 17px;
  font-weight: 700;
}

.brand-name {
  font-size: 16px;
  font-weight: 700;
  color: #fff;
  letter-spacing: 0.06em;
}

.brand-sub {
  font-size: 10.5px;
  color: #7f929b;
}

.side-foot {
  margin-top: auto;
  padding-top: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.main > .mobile-nav { display: none; }

.side-note {
  margin-bottom: 8px;
}

.side-note-text {
  font-size: 11px;
  line-height: 1.6;
  color: #7f929b;
}

.side-version {
  margin-top: 10px;
  font-size: 11px;
  color: #63767e;
  font-family: var(--font-mono);
}

.main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  height: 100%;
  /* 关键：没有 min-height:0 时，内容再高也压不住 flex 子项的最小高度，
     `.content` 会被顶开、整页（含左侧导航）一起滚动，看起来像"侧栏空白" */
  min-height: 0;
  overflow: hidden;
}

.top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  height: var(--topbar-h);
  flex: none;
  padding: 0 24px;
  background: var(--paper);
  border-bottom: 1px solid var(--line);
}

.page-title {
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.03em;
}

.page-sub {
  font-size: 11.5px;
  color: var(--text-3);
}

.stat-mini {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 11.5px;
  padding-right: 12px;
  border-right: 1px solid var(--line);
}

.stat-mini b {
  font-size: 14px;
  color: var(--text);
}

.identity {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 5px 12px 5px 6px;
  border: 1px solid var(--line-strong);
  border-radius: 20px;
  background: var(--paper);
  cursor: pointer;
  text-align: left;
}

.identity:hover {
  border-color: var(--brand-500);
}

.id-avatar {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--brand-050);
  color: var(--brand-700);
  font-size: 13px;
  font-weight: 600;
}

.id-text {
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}

.id-text b {
  font-size: 12.5px;
  font-weight: 600;
}

.id-text i {
  font-size: 10.5px;
  font-style: normal;
  color: var(--text-3);
}

.content {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px 32px;
}

.tab-warning {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 9px 24px;
  background: var(--st-orange-bg);
  border-bottom: 1px solid #f0d9b5;
  color: #8a4a04;
  font-size: 12.5px;
}

.duty {
  margin-top: 14px;
}

@media (max-width: 980px) {
  .shell {
    grid-template-columns: minmax(0, 1fr);
  }

  .side {
    display: none;
  }

  .main > .mobile-nav { display: flex; }
}

@media (max-width: 600px) {
  .top { padding: 0 12px; gap: 10px; }
  .top > div:first-child { min-width: 0; }
  .top > .row { flex: none; gap: 8px; }
  .page-title, .id-text b, .id-text i { white-space: nowrap; }
  .page-sub, .stat-mini { display: none; }
  .content { padding: 14px 12px 24px; }
}
</style>
