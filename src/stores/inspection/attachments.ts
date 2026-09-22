/**
 * 照片附件仓储。
 *
 * 只留压缩图与缩略图（压缩与预算在 db/inspection/attachments.ts）；页面按问题或工单取图。
 * 保存失败必须让调用方拿到异常并保留草稿，不允许显示虚假的"上传成功"。
 */
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { IssueAttachment } from '@/types/inspection'
import { attachmentBudget, removePhoto, savePhoto, totalPhotoBytes } from '@/db/inspection/attachments'
import { db } from '@/db/database'

export const useAttachmentStore = defineStore('inspectionAttachments', () => {
  const attachments = ref<IssueAttachment[]>([])
  const loaded = ref(false)

  const totalBytes = computed(() => totalPhotoBytes(attachments.value))

  async function reload(): Promise<void> {
    attachments.value = await db.attachments.toArray()
    loaded.value = true
  }

  function byId(id: string): IssueAttachment | undefined {
    return attachments.value.find((row) => row.id === id)
  }

  const ofIssue = (issueId: string): IssueAttachment[] => attachments.value.filter((row) => row.issueId === issueId)

  /** 该问题下是否已有这张草稿的附件（用于补关联而不是重复上传） */
  const ofDraft = (issueId: string, draftId: string): IssueAttachment | undefined =>
    attachments.value.find((row) => row.issueId === issueId && row.draftId === draftId)
  const ofOrder = (orderId: string): IssueAttachment[] => attachments.value.filter((row) => row.workOrderId === orderId)

  /**
   * 该工单下已有的附件（**读库**，不看内存缓存）。
   * 补传判断必须以此为准：缓存"命中但已过期"时会把已在库的照片当成没传过，重复上传一遍。
   */
  async function existingOfOrder(orderId: string): Promise<IssueAttachment[]> {
    return db.attachments.where('workOrderId').equals(orderId).toArray()
  }

  /** 还可以再传几张：页面在上传前先问一句，超限就不让选图。 */
  function budgetFor(existing: IssueAttachment[], nextBytes: number) {
    return attachmentBudget(existing, nextBytes)
  }

  async function add(input: Parameters<typeof savePhoto>[0]): Promise<IssueAttachment> {
    const row = await savePhoto(input)
    await reload()
    return row
  }

  async function remove(id: string): Promise<void> {
    await removePhoto(id)
    await reload()
  }

  async function reset(): Promise<void> {
    attachments.value = []
    loaded.value = false
  }

  return { attachments, loaded, totalBytes, byId, ofIssue, ofOrder, ofDraft, existingOfOrder, budgetFor, add, remove, reload, reset }
})
