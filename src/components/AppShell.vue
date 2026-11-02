<script setup lang="ts">
/** 应用外壳：左侧导航 + 顶栏（页面标题、数据模式提示、演示身份切换）。 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { APP_STAGE, APP_VERSION, DEMO_ROLES, ROLES } from "@/types/catalog";
import { useArchiveStore } from "@/stores/archive";
import { listenExternalChange } from "@/db/tabSync";
import { useSessionStore } from "@/stores/session";
import AppModal from "@/components/ui/AppModal.vue";
import AppButton from "@/components/ui/AppButton.vue";
import FormGrid from "@/components/ui/FormGrid.vue";
import StatusTag from "@/components/ui/StatusTag.vue";
import AlertCenter from "@/components/ui/overlay/AlertCenter.vue";
import AssistantPanel from "@/components/assistant/AssistantPanel.vue";
import NavGroups from "@/components/shell/NavGroups.vue";
import FeatureLinks from "@/components/shell/FeatureLinks.vue";
import PageStage from "@/components/shell/PageStage.vue";
import FloatingXiaotong from "@/components/assistant/FloatingXiaotong.vue";
import { useAssistantStore } from "@/assistant/session";
import { useAlertStore } from "@/stores/alerts";
import { isShowcase } from "@/core/demo/workspace";
import ShowcaseControls from "@/components/demo/ShowcaseControls.vue";
import OperationReceipt from "@/components/demo/OperationReceipt.vue";
import { backendEnabled } from "@/api/http/runtime";
import { backendActive } from "@/api/backend/runtime";
import BackendIdentity from "@/components/session/BackendIdentity.vue";
import { useShowcaseStore } from "@/stores/demo/showcase/session";
import CampusBackdrop from "@/components/visual/CampusBackdrop.vue";
import WorkspaceIntro from "@/components/visual/WorkspaceIntro.vue";
import UiGlyph from "@/components/visual/UiGlyph.vue";
import QuickNavigation from "@/components/shell/QuickNavigation.vue";
import RouteProgress from "@/components/shell/RouteProgress.vue";
import CompanionCard from "@/components/shell/CompanionCard.vue";
const showcase = useShowcaseStore();
const compactSidebar = ref(false);
const mainContent = ref<HTMLElement | null>(null);

function focusContent(): void {
  mainContent.value?.focus();
}

const route = useRoute();
const archive = useArchiveStore();
const session = useSessionStore();
const alerts = useAlertStore();
/** 红色预警弹窗出现时，悬浮小瞳的装饰动画要让位 */
const alertStrongVisible = computed(() => alerts.activeStrong !== null);

const pageTitle = computed(() => String(route.meta.title ?? ""));
const pageSub = computed(() => String(route.meta.sub ?? ""));
const mode = computed(() => archive.dataMode);
/** 服务端模式下不再声称数据在本机浏览器；数据源提示必须与实际权威存储一致。 */
const serverMode = computed(() => backendActive());

/**
 * 问筑瞳半屏面板的开关与焦点回位。
 * 入口是可拖动的悬浮小瞳（FloatingXiaotong），面板不做焦点陷阱（桌面端左侧页面仍要能用），
 * 所以"从哪开、回哪去"由壳层负责：关闭后把焦点交回悬浮入口。
 */
const assistant = useAssistantStore();
const floatingEntry = ref<{ focus: () => void } | null>(null);

function closeAssistant(): void {
  assistant.close();
  floatingEntry.value?.focus();
}

const identityOpen = ref(false);

const identityFields = [
  {
    key: "name",
    label: "操作人姓名",
    type: "text" as const,
    required: true,
    placeholder: "例如 张工",
  },
  {
    key: "role",
    label: "演示角色",
    type: "select" as const,
    required: true,
    options: DEMO_ROLES.map((row) => ({ value: row.key, label: row.name })),
    hint: "角色切换用于区分操作留痕；V0.1 的切换不等于真实鉴权",
  },
];

const identityModel = ref<Record<string, unknown>>({ name: "", role: "" });

function openIdentity(): void {
  identityModel.value = { name: session.name, role: session.role };
  identityOpen.value = true;
}

function saveIdentity(): void {
  const name = String(identityModel.value.name ?? "").trim();
  const role = String(identityModel.value.role ?? "");
  if (name === "" || role === "") return;
  session.setIdentity(name, role);
  identityOpen.value = false;
}

const roleDuty = computed(
  () => ROLES.find((row) => row.key === identityModel.value.role)?.duty ?? "",
);

/** 其它标签页写入过数据：提示刷新，避免两个窗口互相覆盖。 */
const externalChange = ref(false);
let stopListening: (() => void) | null = null;

onMounted(() => {
  stopListening = listenExternalChange(() => {
    externalChange.value = true;
  });
});

onBeforeUnmount(() => {
  stopListening?.();
  stopListening = null;
});

function reloadPage(): void {
  window.location.reload();
}
</script>

<template>
  <div class="shell" :class="{ 'shell--compact': compactSidebar }">
    <CampusBackdrop />
    <a class="skip-link" href="#main-content" @click.prevent="focusContent"
      >跳到页面内容</a
    >
    <aside class="side">
      <div class="brand">
        <div class="brand-mark"><UiGlyph name="eye" :size="29" /></div>
        <div class="brand-copy">
          <div class="brand-name">筑瞳</div>
          <div class="brand-sub">校园建筑健康监测与预警</div>
        </div>
      </div>

      <NavGroups />

      <div class="side-foot">
        <CompanionCard @ask="assistant.toggle()" />
        <div class="side-note">
          <StatusTag
            :tone="serverMode ? 'brand' : mode === 'seed' ? 'brand' : 'gray'"
            :text="
              serverMode
                ? '服务端数据 · demo-main'
                : mode === 'seed'
                  ? '示例数据模式'
                  : '空白建档模式'
            "
          />
        </div>
        <details class="source-details">
          <summary>版本与存储说明</summary>
          <p class="side-note-text">
            <template v-if="serverMode"
              >数据保存在服务端 SQLite
              与私有文件目录；刷新或更换浏览器不会改变业务事实。</template
            >
            <template v-else
              >数据保存在本机浏览器数据库中，清除浏览器数据会丢失内容，请在设置页定期导出备份。</template
            >
          </p>
          <p class="side-version">
            {{ APP_VERSION }} · {{ APP_STAGE }} ·
            {{ backendEnabled ? "完整项目接入中" : "纯前端基线" }}
          </p>
        </details>
      </div>
    </aside>

    <div class="main">
      <header class="top">
        <div class="top-leading">
          <button
            type="button"
            class="sidebar-toggle"
            aria-label="收起或展开侧边导航"
            :aria-expanded="!compactSidebar"
            @click="compactSidebar = !compactSidebar"
          >
            <UiGlyph name="menu" :size="19" />
          </button>
          <div>
            <h1 class="page-title">{{ pageTitle }}</h1>
            <div class="page-meta">
              <p class="page-sub">{{ pageSub }}</p>
              <span class="source-chip">{{
                serverMode ? "服务端数据" : "本地数据"
              }}</span>
            </div>
          </div>
        </div>
        <div class="row header-actions">
          <QuickNavigation />
          <div class="stat-mini">
            <span class="muted">在册楼栋</span>
            <b class="num">{{ archive.stats.buildings }}</b>
            <span class="muted">测点</span>
            <b class="num">{{ archive.stats.points }}</b>
            <span class="muted">设备</span>
            <b class="num">{{ archive.stats.devices }}</b>
          </div>
          <AppButton class="header-assistant" @click="assistant.toggle()"
            ><UiGlyph name="eye" :size="17" />问小瞳</AppButton
          >
          <AlertCenter />
          <BackendIdentity v-if="backendEnabled" :disabled="showcase.running" />
          <button
            v-else
            class="identity"
            type="button"
            :disabled="showcase.running"
            @click="openIdentity"
          >
            <span class="id-avatar">{{ session.name.slice(0, 1) }}</span>
            <span class="id-text">
              <b>{{ session.name }}</b>
              <i>{{ session.roleLabel }}</i>
            </span>
          </button>
        </div>
        <RouteProgress />
      </header>

      <NavGroups compact class="mobile-nav" />

      <div v-if="externalChange" class="tab-warning">
        <span
          >检测到另一个标签页修改了本机数据。本版本不做跨标签页同步，继续在本页操作可能覆盖对方的改动。</span
        >
        <AppButton size="sm" @click="reloadPage">刷新页面</AppButton>
      </div>

      <main id="main-content" ref="mainContent" class="content" tabindex="-1">
        <div class="page-container">
          <ShowcaseControls v-if="isShowcase" compact />
          <OperationReceipt />
          <FeatureLinks />
          <WorkspaceIntro />
          <div :inert="showcase.running"><PageStage /></div>
        </div>
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

    <AppModal
      :open="identityOpen"
      title="切换演示身份"
      sub="操作留痕使用当前身份，请按演示角色切换"
      :width="520"
      @close="identityOpen = false"
    >
      <FormGrid v-model="identityModel" :fields="identityFields" :columns="1" />
      <p v-if="roleDuty" class="notice notice--brand duty">
        职责：{{ roleDuty }}
      </p>
      <template #footer>
        <AppButton @click="identityOpen = false">取消</AppButton>
        <AppButton variant="primary" @click="saveIdentity">应用身份</AppButton>
      </template>
    </AppModal>
  </div>
</template>

<style scoped src="@/styles/refresh/shell.css"></style>
