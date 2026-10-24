/** 服务端照片上传与读取：业务照片先上传，再在业务命令里以 mediaId 关联。 */
import type { IssueAttachment } from '@/types/inspection'
import { blobOf, commandRaw, read } from './runtime'

export interface RemoteMedia {
  id: string
  fileName: string
  mimeType: string
  size: number
  sha256: string
  width: number
  height: number
  contentUrl: string
  uploadedAt: string
  uploadedBy: string
  capturedAt: string | null
}

export interface RemoteAttachment extends Omit<IssueAttachment, 'blob' | 'thumb'> {
  mediaId: string
  sha256: string
  contentUrl: string
}

export async function uploadMedia(input: {
  blob: Blob
  fileName: string
  draftId: string
  pointId?: string | null
  capturedAt?: string | null
  origin?: string | null
}): Promise<RemoteMedia> {
  const params = new URLSearchParams({ fileName: input.fileName })
  if (input.pointId) params.set('pointId', input.pointId)
  if (input.capturedAt) params.set('capturedAt', input.capturedAt)
  if (input.origin) params.set('origin', input.origin)
  const result = await commandRaw<RemoteMedia>(`/media?${params.toString()}`, {
    rawBody: input.blob,
    contentType: input.blob.type || 'image/jpeg',
    key: `media|${input.draftId}`,
  })
  return result.data
}

export async function fetchAttachments(): Promise<RemoteAttachment[]> {
  return read<RemoteAttachment[]>('/attachments')
}

/** 附件预览需要真实字节：服务端内容接口带身份校验，不能直接当 img src。 */
export async function fetchAttachmentBlob(contentUrl: string): Promise<Blob> {
  return blobOf(contentUrl)
}
