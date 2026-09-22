/** 表单字段描述：由声明式 schema 驱动统一渲染与校验，避免四套重复表单组件。 */

export type FieldType = 'text' | 'number' | 'select' | 'date' | 'datetime' | 'textarea' | 'readonly'

export interface FieldOption {
  value: string
  label: string
}

export interface FieldDef {
  key: string
  label: string
  type: FieldType
  required?: boolean
  unit?: string
  placeholder?: string
  hint?: string
  /** 静态选项，或依赖当前表单模型动态计算的选项（例如楼层随楼栋变化）。 */
  options?: FieldOption[] | ((model: Record<string, unknown>) => FieldOption[])
  min?: number
  max?: number
  step?: number
  digits?: number
  /** 1 = 单列，2 = 占满整行 */
  span?: 1 | 2
  rows?: number
  visible?: (model: Record<string, unknown>) => boolean
}

export interface ValidationIssue {
  field: string
  message: string
}
