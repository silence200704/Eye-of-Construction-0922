/**
 * 本地备份与恢复（V0.1 基础版：业务数据与日志，附件在 V1.0 纳入）。
 * 恢复前校验格式并自动保留当前数据快照，避免误导入覆盖。
 */
import { APP_VERSION, BACKUP_FORMAT, SCHEMA_VERSION } from '@/types/catalog'
import type { BackupAttachment, BackupPackage, MonitorRecord } from '@/types/domain'
import type { IssueAttachment } from '@/types/inspection'
import type { Dataset } from './repo'

export interface ParseResult {
  ok: boolean
  errors: string[]
  data: BackupPackage | null
}

export interface BackupEstimate {
  /** 附件张数与压缩后的总字节数 */
  photoCount: number
  photoBytes: number
  /** 整个备份序列化后的字节数（含照片的 base64 膨胀） */
  totalBytes: number
}

/** 导出前的体积预估：页面按它显示"含照片 N 张，预计 X MB"，超过上限再提示用户。 */
export function estimateBackup(pkg: BackupPackage): BackupEstimate {
  const photos = pkg.data.attachments ?? []
  // 缩略图不单独记账：估算时按主图的 1.1 倍留余量，避免低估后导出卡住
  const photoBytes = photos.reduce((sum, row) => sum + row.size, 0)
  return {
    photoCount: photos.length,
    photoBytes,
    totalBytes: new Blob([JSON.stringify(pkg)]).size,
    // 说明：photoBytes 是压缩后主图之和，totalBytes 已包含 base64 膨胀后的实际体积
  }
}

/**
 * 导出：把附件里的 Blob 转成 data URL，其余数据原样序列化。
 *
 * **数据已损坏的附件（blob 不是 Blob）会被跳过，不中断导出**：早期版本用 JSON 深拷贝写库，
 * 照片存进去就只剩 `{}`，这种行已经救不回来；但让它把整份备份卡死会连累其余全部数据。
 * 跳过的条数写进 `brokenPhotos`，页面据此如实提示，不假装导出完整。
 */
export async function buildBackup(data: Dataset, actor: string): Promise<BackupPackage> {
  const { rows: attachments, broken } = await encodeAttachments(data.attachments)
  return {
    format: BACKUP_FORMAT,
    appVersion: APP_VERSION,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    exportedBy: actor,
    counts: {
      buildings: data.buildings.length,
      floors: data.floors.length,
      points: data.points.length,
      devices: data.devices.length,
      baselines: data.baselines.length,
      records: data.records.length,
      audits: data.audits.length,
      rules: data.rules.length,
      events: data.events.length,
      notifications: data.notifications.length,
      plans: data.plans.length,
      tasks: data.tasks.length,
      issues: data.issues.length,
      workOrders: data.workOrders.length,
      attachments: data.attachments.length,
    },
    data: {
      buildings: data.buildings,
      floors: data.floors,
      points: data.points,
      devices: data.devices,
      baselines: data.baselines,
      records: data.records.map(normalizeRecord),
      audits: data.audits,
      rules: data.rules,
      events: data.events,
      notifications: data.notifications,
      plans: data.plans,
      tasks: data.tasks,
      issues: data.issues,
      workOrders: data.workOrders,
      attachments,
    },
    brokenPhotos: broken,
  }
}

async function encodeAttachments(rows: IssueAttachment[]): Promise<{ rows: BackupAttachment[]; broken: number }> {
  const out: BackupAttachment[] = []
  let broken = 0
  for (const row of rows) {
    const { blob, thumb, ...meta } = row
    // 损坏行（blob 已不是 Blob）跳过：对它调 arrayBuffer 会直接抛错，让整份备份都导不出来
    if (!(blob instanceof Blob) || !(thumb instanceof Blob)) {
      broken += 1
      continue
    }
    out.push({ ...meta, blob: await blobToDataUrl(blob), thumb: await blobToDataUrl(thumb) })
  }
  return { rows: out, broken }
}

/**
 * Blob → base64 data URL。
 * 用 arrayBuffer + btoa 而不是 FileReader：不依赖 DOM，浏览器与测试环境都能跑，
 * 备份编码这条路径才能被真实往返测试覆盖。
 */
export async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`
}

/** data URL → Blob：atob 是同步的，因此恢复流程不需要 await。 */
export function dataUrlToBlob(dataUrl: string, fallbackType = 'image/jpeg'): Blob {
  const comma = dataUrl.indexOf(',')
  if (comma === -1) return new Blob([], { type: fallbackType })
  const header = dataUrl.slice(0, comma)
  const body = dataUrl.slice(comma + 1)
  const type = /:(.*?);/.exec(header)?.[1] ?? fallbackType
  const binary = atob(body)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new Blob([bytes], { type })
}

function normalizeRecord(record: MonitorRecord): MonitorRecord {
  return { ...record, revisions: Array.isArray(record.revisions) ? record.revisions : [] }
}

export function parseBackup(text: string): ParseResult {
  const errors: string[] = []
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, errors: ['文件不是有效的 JSON，无法解析'], data: null }
  }
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, errors: ['备份内容结构不正确'], data: null }
  }
  const candidate = raw as Partial<BackupPackage>
  if (candidate.format !== BACKUP_FORMAT) {
    errors.push(`备份格式标识不匹配，期望 ${BACKUP_FORMAT}`)
  }
  const version = typeof candidate.schemaVersion === 'number' ? candidate.schemaVersion : -1
  if (version < 0) {
    errors.push('缺少数据结构版本号')
  } else if (version > SCHEMA_VERSION) {
    errors.push(`备份数据结构版本 v${version} 高于当前程序支持的 v${SCHEMA_VERSION}，请使用较新版本恢复`)
  }
  const data = candidate.data
  if (typeof data !== 'object' || data === null) {
    errors.push('备份缺少 data 内容')
  } else {
    const required: (keyof Dataset)[] = ['buildings', 'floors', 'points', 'devices', 'baselines', 'records', 'audits']
    // rules 在 v2 引入；旧备份缺该字段时按空数组恢复，不阻断导入
    for (const key of required) {
      if (!Array.isArray((data as unknown as Record<string, unknown>)[key])) {
        errors.push(`备份缺少 ${key} 列表`)
      }
    }
  }
  if (errors.length > 0) return { ok: false, errors, data: null }
  return { ok: true, errors: [], data: candidate as BackupPackage }
}

export function toDataset(pkg: BackupPackage): Dataset {
  return {
    buildings: pkg.data.buildings,
    floors: pkg.data.floors,
    points: pkg.data.points,
    devices: pkg.data.devices,
    baselines: pkg.data.baselines,
    records: pkg.data.records.map(normalizeRecord),
    audits: pkg.data.audits,
    rules: Array.isArray(pkg.data.rules) ? pkg.data.rules : [],
    events: Array.isArray(pkg.data.events) ? pkg.data.events : [],
    notifications: Array.isArray(pkg.data.notifications) ? pkg.data.notifications : [],
    plans: Array.isArray(pkg.data.plans) ? pkg.data.plans : [],
    tasks: Array.isArray(pkg.data.tasks) ? pkg.data.tasks : [],
    issues: Array.isArray(pkg.data.issues) ? pkg.data.issues : [],
    workOrders: Array.isArray(pkg.data.workOrders) ? pkg.data.workOrders : [],
    attachments: decodeAttachments(pkg.data.attachments),
  }
}

/** 恢复：把 data URL 还原成 Blob；结构不全的条目直接丢弃，不让坏数据进库。 */
function decodeAttachments(rows: BackupAttachment[] | undefined): IssueAttachment[] {
  if (!Array.isArray(rows)) return []
  const out: IssueAttachment[] = []
  for (const row of rows) {
    if (typeof row.blob !== 'string' || typeof row.id !== 'string') continue
    const { blob, thumb, ...meta } = row
    out.push({ ...meta, blob: dataUrlToBlob(blob, row.mimeType), thumb: dataUrlToBlob(thumb, row.mimeType) })
  }
  return out
}

export function downloadBackup(pkg: BackupPackage): void {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')
  const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `zhutong-backup-${stamp}.json`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsText(file)
  })
}
