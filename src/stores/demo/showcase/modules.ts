import { db } from '@/db/database'
import { prepareCompletedInspection } from '@/stores/writes/demo/coverage/inspection'
import { loadMaintenanceScenario, executeTask } from '@/stores/writes/demo/service'
import { loadAlarmVibScenario, loadEnvAlarmScenario } from '@/stores/writes/demo/baseline'

export async function runInspection(): Promise<string> {
  const id = await prepareCompletedInspection({ resume: true })
  if ((await db.tasks.get(id))?.status !== 'checked') throw new Error('巡检没有完成')
  return id
}
export async function runMaintenance(): Promise<string> {
  const result = await loadMaintenanceScenario()
  if (!result.ok) throw new Error(result.message)
  const pending = await db.maintenanceTasks.filter(r => r.status === 'pending' && r.snapshot.planName.startsWith('演示场景：')).toArray()
  for (const task of pending) {
    const outcome = await executeTask(task.id,'normal')
    if ((await db.maintenanceTasks.get(task.id))?.status !== 'done') throw new Error(outcome)
  }
  return pending[0]?.id ?? (await db.maintenanceTasks.toArray())[0]?.id ?? ''
}
export async function runOtherAlarms(): Promise<void> {
  for (const load of [loadAlarmVibScenario,loadEnvAlarmScenario]) {
    const result = await load()
    if (!result.ok) throw new Error(result.message)
  }
}
