/** 表单弹窗共用的模型、校验与提交状态，避免七个弹窗各写一遍。 */
import { ref } from 'vue'
import { validateFields } from './validate'
import type { FieldDef, ValidationIssue } from '@/types/forms'

export function useFormModel(fields: () => FieldDef[]) {
  const model = ref<Record<string, unknown>>({})
  const errors = ref<Record<string, string>>({})
  const submitError = ref('')
  const pending = ref(false)

  function reset(next: Record<string, unknown>): void {
    model.value = { ...next }
    errors.value = {}
    submitError.value = ''
  }

  function applyIssues(issues: ValidationIssue[]): boolean {
    errors.value = Object.fromEntries(issues.map((issue) => [issue.field, issue.message]))
    return issues.length === 0
  }

  /** 字段级错误 + 业务级错误合并展示，业务错误归到指定字段。 */
  function mergeIssues(extra: ValidationIssue[]): boolean {
    submitError.value = ''
    return applyIssues([...validateFields(model.value, fields()), ...extra])
  }

  /**
   * 执行提交动作并捕获异常：写库失败必须让用户看见，不能静默失败。
   * 返回 true 表示提交成功。
   */
  async function run(action: () => Promise<void>): Promise<boolean> {
    if (pending.value) return false
    pending.value = true
    submitError.value = ''
    try {
      await action()
      return true
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      const fields = (cause as { details?: { fields?: Array<{ field?: string; message?: string }> } })
        ?.details?.fields
      submitError.value = Array.isArray(fields) && fields.length > 0
        ? `${message}：${fields.map((item) => [item.field, item.message].filter(Boolean).join(' ')).join('；')}`
        : message
      return false
    } finally {
      pending.value = false
    }
  }

  return { model, errors, submitError, pending, reset, mergeIssues, run }
}
