/**
 * 小瞳视觉巡检联动门面（方案 §34/§36）。
 *
 * 三条产线在这里合流：
 * - `compose`：把数值、趋势、照片与区域差异组合成回答（纯函数，可单测）；
 * - `run`：按需读取内置素材、跑区域对比，把结果交给 `compose`；
 * - `recovery` / `nav`：读数恢复问答与 3D 定位问答（都只引用已有结论与既有深链）。
 */
export { COMPARE_METHOD_TEXT, REGION_LABEL, composeVisualEvidence, noFramesDraft, type VisualEvidenceInput } from './compose'
export { answerVisualEvidence, type VisualEvidenceRequest } from './run'
export { answerReadingRecovery, type RecoveryAnswerInput } from './recovery'
export { answerSpatialGo, type SpatialGoAnswerInput } from './nav'
