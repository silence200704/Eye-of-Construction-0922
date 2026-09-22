<script setup lang="ts">
/**
 * 全局预警提醒入口。
 * 红色事件以可键盘关闭的强提醒呈现；黄色、橙色与批量导入结果进入提醒中心。
 * 它只展示本浏览器会话中新生成的提醒，真实通知状态仍由预警中心的通知记录承载。
 */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { EVENT_LEVEL_LABEL, type EventLevel } from '@/types/events'
import { useAlertStore, type AlertInboxItem } from '@/stores/alerts'
import AppModal from '../AppModal.vue'
import AppButton from '../AppButton.vue'
import StatusTag from '../StatusTag.vue'

const alerts = useAlertStore()
const router = useRouter()
const inboxOpen = ref(false)

const unreadLabel = computed(() => (alerts.unreadCount > 99 ? '99+' : String(alerts.unreadCount)))

function tone(level: EventLevel): 'yellow' | 'orange' | 'red' {
  return level
}

function openInbox(): void {
  inboxOpen.value = !inboxOpen.value
  if (inboxOpen.value) alerts.markAllSeen()
}

async function openEvent(item: AlertInboxItem): Promise<void> {
  alerts.dismiss(item.key)
  inboxOpen.value = false
  await router.push(item.eventId === null ? '/alarms' : { path: '/alarms', query: { event: item.eventId } })
}

async function later(item: AlertInboxItem): Promise<void> {
  alerts.dismiss(item.key)
}
</script>

<template>
  <div class="alert-center">
    <button
      class="alert-trigger"
      type="button"
      :aria-expanded="inboxOpen"
      aria-controls="alert-inbox"
      :aria-label="`预警提醒，${alerts.unreadCount} 条未读`"
      @click="openInbox"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M18 9a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <span>预警提醒</span>
      <b v-if="alerts.unreadCount > 0" class="alert-count" aria-hidden="true">{{ unreadLabel }}</b>
    </button>

    <section v-if="inboxOpen" id="alert-inbox" class="alert-inbox" aria-label="预警提醒列表">
      <div class="inbox-head">
        <div>
          <b>本次会话提醒</b>
          <span>新建或升级事件才会出现</span>
        </div>
        <AppButton size="sm" variant="ghost" @click="alerts.markAllSeen">全部已读</AppButton>
      </div>
      <div v-if="alerts.newest.length === 0" class="inbox-empty">暂时没有新提醒。手工录入或批量导入越限数据后会显示在这里。</div>
      <article v-for="item in alerts.newest" :key="item.key" class="inbox-item" :class="{ 'inbox-item--unread': item.seenAt === null }">
        <div class="inbox-item-head">
          <StatusTag :tone="tone(item.level)" :text="EVENT_LEVEL_LABEL[item.level]" />
          <span v-if="item.seenAt === null" class="unread-dot">未读</span>
        </div>
        <b>{{ item.title }}</b>
        <p>{{ item.detail }}</p>
        <small>{{ item.targetText }}</small>
        <AppButton size="sm" variant="ghost" @click="openEvent(item)">{{ item.kind === 'batch' ? '查看预警中心' : '查看事件详情' }}</AppButton>
      </article>
    </section>

    <AppModal
      :open="alerts.activeStrong !== null"
      title="红色预警提醒"
      sub="已生成站内通知，请立即核对事件并安排处置。此提醒不代表外部短信或电话已送达。"
      :width="620"
      :close-on-backdrop="false"
      @close="alerts.activeStrong !== null && later(alerts.activeStrong)"
    >
      <template v-if="alerts.activeStrong !== null">
        <div class="strong-alert">
          <StatusTag tone="red" :text="EVENT_LEVEL_LABEL[alerts.activeStrong.level]" />
          <div>
            <h4>{{ alerts.activeStrong.title }}</h4>
            <p>{{ alerts.activeStrong.detail }}</p>
            <p class="muted">{{ alerts.activeStrong.targetText }}</p>
          </div>
        </div>
      </template>
      <template #footer>
        <AppButton @click="alerts.activeStrong !== null && later(alerts.activeStrong)">稍后处理</AppButton>
        <AppButton variant="danger" @click="alerts.activeStrong !== null && openEvent(alerts.activeStrong)">查看并处置</AppButton>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.alert-center { position: relative; }
.alert-trigger { min-width: 44px; height: 44px; display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--line-strong); border-radius: 22px; padding: 0 10px; background: var(--paper); color: var(--text); cursor: pointer; font: inherit; font-size: 12px; }
.alert-trigger:hover { border-color: var(--st-orange); color: var(--st-orange); }
.alert-count { display: grid; place-items: center; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; background: var(--st-red); color: #fff; font-family: var(--font-mono); font-size: 10px; }
.alert-inbox { position: absolute; z-index: 40; top: calc(100% + 8px); right: 0; width: min(420px, calc(100vw - 28px)); max-height: min(560px, calc(100vh - 84px)); overflow-y: auto; padding: 12px; border: 1px solid var(--line-strong); border-radius: var(--r-md); background: var(--paper); box-shadow: var(--shadow-pop); }
.inbox-head, .inbox-item-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.inbox-head { padding: 2px 2px 10px; border-bottom: 1px solid var(--line); }
.inbox-head div { display: grid; gap: 1px; }
.inbox-head span, .inbox-item small, .inbox-item p { font-size: 12px; color: var(--text-2); }
.inbox-empty { padding: 22px 8px; color: var(--text-3); font-size: 12.5px; text-align: center; }
.inbox-item { display: grid; gap: 7px; padding: 12px 8px; border-bottom: 1px solid var(--line); }
.inbox-item:last-child { border-bottom: 0; }
.inbox-item--unread { border-left: 3px solid var(--brand-500); padding-left: 9px; background: var(--brand-050); }
.inbox-item b { font-size: 13px; }
.inbox-item p { margin: 0; line-height: 1.5; }
.unread-dot { color: var(--brand-700); font-size: 11px; font-weight: 600; }
.strong-alert { display: flex; align-items: flex-start; gap: 12px; padding: 14px; border: 1px solid #e6b6b1; border-radius: var(--r-md); background: var(--st-red-bg); }
.strong-alert h4 { margin: 0 0 5px; font-size: 15px; color: var(--st-red); }
.strong-alert p { margin: 3px 0; font-size: 13px; }
@media (max-width: 720px) { .alert-trigger span { display: none; } }
</style>
