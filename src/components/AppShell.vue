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

const route = useRoute()
const archive = useArchiveStore()
const session = useSessionStore()

const pageTitle = computed(() => String(route.meta.title ?? ''))
const pageSub = computed(() => String(route.meta.sub ?? ''))
const mode = computed(() => archive.dataMode)

const NAV = [
  { to: '/', label: '校园总览', d: 'M3 10.5 12 4l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z' },
  { to: '/campus', label: '校园地图', d: 'M9 3 3 5.5v15L9 18l6 3 6-2.5v-15L15 6zM9 3v15M15 6v15' },
  { to: '/archive', label: '建筑与设备', d: 'M4 21V6l8-3 8 3v15M9 21v-5h6v5M9 10h.01M15 10h.01M9 13.5h.01M15 13.5h.01' },
  { to: '/monitor', label: '监测数据', d: 'M3 17l4-6 4 3 3-5 4 4h3M3 21h18' },
  { to: '/trend', label: '监测趋势', d: 'M3 20h18M6 16l4-8 4 5 3-6 4 9' },
  { to: '/inspection', label: '点检巡检', d: 'M9 11l2 2 4-4M5 4h14v16H5zM9 3v3M15 3v3' },
  { to: '/issues', label: '问题与工单', d: 'M8 5h8M8 12h8M8 19h5M4 4h16v16H4z' },
  { to: '/alarms', label: '预警中心', d: 'M12 3l9 16H3zM12 9v5M12 17h.01' },
  { to: '/standards', label: '预警标准', d: 'M4 5h16M4 12h16M4 19h10M8 3v4M15 10v4M11 17v4' },
  { to: '/settings', label: '系统设置', d: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7.5 19l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 13.6H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.7 7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z' },
]

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

      <nav class="nav">
        <RouterLink v-for="item in NAV" :key="item.to" :to="item.to" class="nav-item">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path :d="item.d" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span>{{ item.label }}</span>
        </RouterLink>
      </nav>

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
          <button class="identity" type="button" @click="openIdentity">
            <span class="id-avatar">{{ session.name.slice(0, 1) }}</span>
            <span class="id-text">
              <b>{{ session.name }}</b>
              <i>{{ session.roleLabel }}</i>
            </span>
          </button>
        </div>
      </header>

      <div v-if="externalChange" class="tab-warning">
        <span>检测到另一个标签页修改了本机数据。本版本不做跨标签页同步，继续在本页操作可能覆盖对方的改动。</span>
        <AppButton size="sm" @click="reloadPage">刷新页面</AppButton>
      </div>

      <main class="content">
        <RouterView />
      </main>
    </div>

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
  height: 100%;
}

.side {
  display: flex;
  flex-direction: column;
  background:
    repeating-linear-gradient(135deg, rgba(255, 255, 255, 0.028) 0 1px, transparent 1px 9px),
    linear-gradient(180deg, var(--ink-900) 0%, var(--ink-950) 100%);
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

.nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 14px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 38px;
  padding: 0 10px;
  border-radius: var(--r-sm);
  color: #b3c2c9;
  font-size: 13.5px;
  border-left: 2px solid transparent;
}

.nav-item:hover {
  background: rgba(255, 255, 255, 0.05);
  color: #fff;
}

.nav-item.router-link-exact-active {
  background: rgba(20, 134, 149, 0.16);
  border-left-color: var(--brand-500);
  color: #fff;
  font-weight: 600;
}

.side-foot {
  margin-top: auto;
  padding-top: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

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
  font-size: 16px;
  font-weight: 600;
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
}
</style>
