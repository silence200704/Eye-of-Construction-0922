/**
 * 共享的"现在"刻度（V1-C.1）。
 *
 * `Date.now()` 与 `new Date()` 都不是响应式的：跨天或页面长时间停留时，
 * "今天有哪些任务""复查逾期几天""通知是否超时"这些按时间算的判定不会自己变。
 * 这里只提供**显式推进** —— 页面上的刷新按钮调 `refresh()`，
 * 不引后台定时器（演示里不该出现说不清来源的自动变化）。
 *
 * 任务、事件、复查三处共用同一个刻度，避免"点了一个刷新按钮，另一个数字没动"。
 */
import { ref } from 'vue'
import { defineStore } from 'pinia'
import { nowIso, todayInput } from '@/core/time'

export const useClockStore = defineStore('clock', () => {
  /** 本地日期 YYYY-MM-DD：按天算的判定（今日待办、复查逾期）读它 */
  const todayKey = ref(todayInput())
  /** 当前时刻 ISO：按分钟算的判定（通知超时）读它 */
  const nowKey = ref(nowIso())

  function refresh(): void {
    todayKey.value = todayInput()
    nowKey.value = nowIso()
  }

  return { todayKey, nowKey, refresh }
})
