/** 演示准备契约：计划只读，回执只报本次请求实际涉及的对象。 */
export type Capability = 'sampling' | 'media' | 'inspection'
export type PreparationObject = { kind: 'record' | 'plan' | 'task' | 'frame' | 'video'; id: string; label: string; source: string }
export interface PreparationPlan {
  requestId: string
  demoSessionId: string
  datasetEpoch: string
  capability: Capability
  pointId: string
  existingIds: string[]
  missing: string[]
  steps: string[]
  limits: { records: number; plans: number; tasks: number; frames: number }
  blockedReasons: string[]
}
export interface PreparationReceipt {
  requestId: string
  demoSessionId: string
  datasetEpoch: string
  capability: Capability
  pointId: string
  at: string
  status: 'ready' | 'blocked' | 'failed' | 'cancelled'
  created: PreparationObject[]
  reused: PreparationObject[]
  skipped: string[]
  failed: string[]
}
