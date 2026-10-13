/**
 * 问筑瞳的受控写入出口。问答解析与回答模板不能导入此模块。
 * `confirmed` 只由确认弹窗的“确认准备”按钮传入；取消时不触碰场景仓储。
 */
import { useDemoScenarioStore } from '@/stores/demo/scenarios'
import type { DemoScenarioKey } from '@/config/demoScenarios'
import type { DemoScenarioResult } from '@/stores/writes/demo/support'

/**
 * 指令白名单 → 现有演示场景键。**只认登记过的指令**，
 * 不接受任意场景名或函数名，也不在这里做任何业务判定。
 */
const COMMAND_SCENARIO: Record<string, DemoScenarioKey> = {
  prepare_red_demo: 'liveResponse',
  prepare_inspection_demo: 'inspection',
}

export function scenarioOfCommand(id: string): DemoScenarioKey {
  const key = COMMAND_SCENARIO[id]
  if (key === undefined) throw new Error(`未登记的演示指令：${id}`)
  return key
}

export async function executeConfirmedCommand(
  id: string,
  confirmed: boolean,
): Promise<DemoScenarioResult | null> {
  const key = scenarioOfCommand(id)
  if (!confirmed) return null
  return useDemoScenarioStore().load(key)
}
