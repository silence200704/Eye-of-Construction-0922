/**
 * 照片附件的压缩与存取。
 *
 * 约定（评审确认）：本地选图 → 客户端压缩 → IndexedDB 存真实照片；
 * 每问题最多 3 张、每张约 200 KB、单问题不超过 600 KB；只留压缩图与缩略图，不留原始大图。
 * 保存失败时调用方必须保留草稿并允许重试，页面不得显示"云端上传成功"这类假状态。
 */
import { ATTACHMENT_LIMITS, type AttachmentKind, type IssueAttachment } from '@/types/inspection'
import { uid } from '@/core/id'
import { nowIso } from '@/core/time'
import { putAttachment, deleteAttachment } from '@/db/repo'

export interface AttachmentBudget {
  ok: boolean
  reason: string
  /** 还能再加几张 */
  remaining: number
  /** 已占字节数 */
  usedBytes: number
}

/** 体积与张数预算：纯计算，便于在表单上实时提示"还能再传几张"。 */
export function attachmentBudget(
  existing: { size: number }[],
  nextBytes: number,
  limits: { count: number; totalBytes: number } = { count: ATTACHMENT_LIMITS.perIssue, totalBytes: ATTACHMENT_LIMITS.totalBytes },
): AttachmentBudget {
  const usedBytes = existing.reduce((sum, row) => sum + row.size, 0)
  const remaining = limits.count - existing.length
  if (remaining <= 0) {
    return { ok: false, reason: `最多上传 ${limits.count} 张，已达上限`, remaining: 0, usedBytes }
  }
  if (usedBytes + nextBytes > limits.totalBytes) {
    return {
      ok: false,
      reason: `单条记录的照片总量不能超过 ${formatBytes(limits.totalBytes)}（已有 ${formatBytes(usedBytes)}，本次 ${formatBytes(nextBytes)}）`,
      remaining,
      usedBytes,
    }
  }
  return { ok: true, reason: '', remaining, usedBytes }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export interface CompressOptions {
  maxBytes: number
  maxEdge: number
}

const DEFAULT_OPTIONS: CompressOptions = { maxBytes: ATTACHMENT_LIMITS.targetBytes, maxEdge: 1280 }
const THUMB_EDGE = 240

export interface CompressedPhoto {
  blob: Blob
  thumb: Blob
  width: number
  height: number
}

/**
 * 压缩：先按最长边缩到 maxEdge，再逐步降质量到目标字节数以内。
 * 画布不可用（极少数环境）时直接抛错，由调用方提示"本机浏览器不支持图片压缩"，不静默存原图。
 */
export async function compressPhoto(file: File, options: Partial<CompressOptions> = {}): Promise<CompressedPhoto> {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, opts.maxEdge / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (ctx === null) throw new Error('本机浏览器不支持图片压缩，无法保存现场照片')
  ctx.drawImage(bitmap, 0, 0, width, height)

  let quality = 0.82
  let blob = await toJpeg(canvas, quality)
  // 每次降 0.12 质量，最多降到 0.4，避免为了体积把照片压到看不清
  while (blob.size > opts.maxBytes && quality > 0.4) {
    quality -= 0.12
    blob = await toJpeg(canvas, quality)
  }

  const thumbCanvas = document.createElement('canvas')
  const thumbScale = Math.min(1, THUMB_EDGE / Math.max(width, height))
  thumbCanvas.width = Math.max(1, Math.round(width * thumbScale))
  thumbCanvas.height = Math.max(1, Math.round(height * thumbScale))
  const thumbCtx = thumbCanvas.getContext('2d')
  if (thumbCtx === null) throw new Error('本机浏览器不支持图片压缩，无法生成缩略图')
  thumbCtx.drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height)

  bitmap.close()
  return { blob, thumb: await toJpeg(thumbCanvas, 0.7), width, height }
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob === null ? reject(new Error('照片压缩失败，请重试')) : resolve(blob)),
      'image/jpeg',
      quality,
    )
  })
}

export interface SavePhotoInput {
  file: File
  kind: AttachmentKind
  issueId: string | null
  workOrderId: string | null
  actor: string
  capturedAt: string | null
  /** 来源草稿标识：重试时据此认出"已入库但未关联"的那张 */
  draftId?: string
}

/** 压缩并入库；库里只存压缩图，原始文件不落盘。 */
export async function savePhoto(input: SavePhotoInput): Promise<IssueAttachment> {
  const photo = await compressPhoto(input.file)
  const row: IssueAttachment = {
    id: uid('att'),
    issueId: input.issueId,
    workOrderId: input.workOrderId,
    kind: input.kind,
    draftId: input.draftId ?? '',
    fileName: input.file.name,
    mimeType: 'image/jpeg',
    size: photo.blob.size,
    width: photo.width,
    height: photo.height,
    uploadedAt: nowIso(),
    uploadedBy: input.actor,
    capturedAt: input.capturedAt,
    blob: photo.blob,
    thumb: photo.thumb,
  }
  await putAttachment(row)
  return row
}

/** 页面草稿的结构（PhotoUploader 的 PhotoDraft 满足它）：**已经是压缩图**，不必再过一遍压缩。 */
export interface DraftPhotoInput {
  id: string
  fileName: string
  blob: Blob
  thumb: Blob
  size: number
  width: number
  height: number
  capturedAt: string | null
}

/**
 * 附件主键 = `att_` + 草稿标识。
 *
 * 用确定性主键而不是随机 ID，是为了让"重试"天然幂等：同一张草稿重复提交时算出同一个主键，
 * 事务里的 bulkPut 覆盖同一行，而不是再插一条一模一样的附件
 * （照片重复上传这个问题在工单侧出过一次）。
 */
export function attachmentIdOf(draftId: string): string {
  return `att_${draftId}`
}

/**
 * 由草稿**构造**附件行（不写库）。
 *
 * 用于"照片要和审核结论一起落库"的场景：压缩在草稿里已经做过，这里只组装字段，
 * 由调用方把它塞进同一个事务（`commitIssueLink` / `commitIssueWithWorkOrder`）。
 * 若单独先把照片写库，审核一旦失败就会留下"附件已经挂在问题上、审核结论却没落库"的半成品 ——
 * 看起来像有处置依据，实际什么事都没定。
 */
export function buildDraftPhoto(
  draft: DraftPhotoInput,
  meta: { kind: AttachmentKind; issueId: string | null; workOrderId: string | null; actor: string },
): IssueAttachment {
  return {
    id: attachmentIdOf(draft.id),
    issueId: meta.issueId,
    workOrderId: meta.workOrderId,
    kind: meta.kind,
    draftId: draft.id,
    fileName: draft.fileName,
    mimeType: 'image/jpeg',
    size: draft.size,
    width: draft.width,
    height: draft.height,
    uploadedAt: nowIso(),
    uploadedBy: meta.actor,
    capturedAt: draft.capturedAt,
    blob: draft.blob,
    thumb: draft.thumb,
  }
}

export interface PhotoSyncPlan<T> {
  /** 已入库但还没关联到问题上的草稿：只需补关联，不要再上传 */
  toLink: { draft: T; attachmentId: string }[]
  /** 真正需要上传的草稿 */
  toUpload: T[]
}

/**
 * 照片同步计划（纯函数）。
 *
 * 关键点：**先认人，再上传**。草稿入库成功但"关联到问题"这一步失败时，
 * 附件表里已经有一条带同一 `draftId` 的记录 —— 此时应该补关联，
 * 而不是当作缺失再传一次（重复上传会留下两条一模一样的附件）。
 */
export function planPhotoSync<T extends { id: string }>(
  drafts: T[],
  existing: Pick<IssueAttachment, 'id' | 'draftId'>[],
  linkedAttachmentIds: string[],
): PhotoSyncPlan<T> {
  const linked = new Set(linkedAttachmentIds)
  const byDraft = new Map<string, string>()
  for (const row of existing) {
    if (row.draftId !== '') byDraft.set(row.draftId, row.id)
  }
  const toLink: PhotoSyncPlan<T>['toLink'] = []
  const toUpload: T[] = []
  for (const draft of drafts) {
    const attachmentId = byDraft.get(draft.id)
    if (attachmentId === undefined) {
      toUpload.push(draft)
      continue
    }
    if (!linked.has(attachmentId)) toLink.push({ draft, attachmentId })
  }
  return { toLink, toUpload }
}

export async function removePhoto(id: string): Promise<void> {
  await deleteAttachment(id)
}

/** 附件总占用，用于设置页与导出前的体积提示。 */
export function totalPhotoBytes(rows: Pick<IssueAttachment, 'size'>[]): number {
  return rows.reduce((sum, row) => sum + row.size, 0)
}
