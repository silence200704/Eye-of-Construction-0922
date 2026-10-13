/**
 * 兜底回答：同名消歧、查无对象、无法识别、影像未接入、写入指令。
 *
 * 这一类回答的存在意义就是"**不给假答案**"：
 * 方案明确要求查无对象时显示"当前数据集找不到"，不能回退到预置答案；
 * 无法识别时给出可问示例，而不是硬猜一个意图。
 */
import { buildLink } from '../actions'
import type { AskCandidate } from '../types'
import { draft, type AnswerDraft } from './shared'

/** 固定问法示例：界面把它渲染成提示按钮，也是"无法识别"时的兜底说明。 */
export function visualExamples(target = 'B03-F2-CRACK01'): string[] {
  return [
    `${target} 的裂缝影像有什么变化？给我看数据和照片`,
    `${target} 这组照片中的完好墙面有没有变化？`,
    `把 ${target} 的前后裂缝照片放大给我看`,
  ]
}

export const ASK_EXAMPLES: string[] = [
  '全校现在监测如何',
  '3号教学楼裂缝测点怎么样',
  '为什么这条是红色',
  '列出还没处理的预警',
  '这个问题处理到哪了？',
  ...visualExamples(),
]

/** 命中多个测点：把候选原样交出去，等用户选，不猜。 */
export function answerAmbiguous(reason: string, candidates: AskCandidate[]): AnswerDraft {
  return draft(reason, {
    status: 'need_choice',
    candidates,
    gaps: ['同名或多项命中时助手不会替你选测点：请点选一个候选，或直接用测点编号提问（例如 B03-F2-CRACK01）。'],
    links: [buildLink('campus_map')],
    dataNotes: ['候选来自当前在册测点档案，已按楼栋与指标线索缩小范围。'],
  })
}

/** 意图认出来了，但当前数据集没有这个对象 / 没有可用于下结论的数据。 */
export function answerNoObject(reason: string): AnswerDraft {
  return draft(reason, {
    status: 'not_found',
    gaps: ['当前数据集里找不到可解释的对象；助手不会退回预置示例或演示数字。'],
    links: [buildLink('campus_map')],
  })
}

/** 完全没认出来：说明能问什么，而不是硬套一个意图。 */
export function answerUnknownQuestion(): AnswerDraft {
  return draft('这句话没有匹配到当前的固定问法，无法确定要查哪个对象。', {
    status: 'unsupported',
    gaps: ['可以这样问：', ...ASK_EXAMPLES.map((text) => `· ${text}`)],
    links: [buildLink('overview')],
    dataNotes: ['本助手是本地规则问答，只覆盖固定问法及其近义说法，不调用外部大模型。'],
  })
}

/** 演示数据只从设置页载入；问答只给导航，不提供第二个写入口。 */
export function answerPrepareRedDemo(): AnswerDraft {
  return draft('临时业务数据统一从「系统设置 → 一键载入全链演示数据」载入；这里不会写入数据。', {
    status: 'answered',
    gaps: [
      '载入后可到预警中心查看红色事件，并继续演示问题、工单与复查。',
    ],
    links: [buildLink('settings')],
    dataNotes: ['这只是导航建议；提问不会新增或修改本地数据。'],
  })
}

/** 其它写入类问法仍不执行，也不借用红色预警场景。 */
export function answerWriteRequest(): AnswerDraft {
  return draft('这条写入请求尚未接入问筑瞳，未修改本地数据。', {
    status: 'unsupported',
    gaps: [
      '临时演示数据请到系统设置载入；其它业务写入仍请到对应工作台操作。',
    ],
    links: [buildLink('settings'), buildLink('monitor')],
    pendingCommands: [],
    dataNotes: ['单纯提问不会新增、修改或删除任何本地数据。'],
  })
}
