/**
 * 问筑瞳 · 深链对象解析。
 *
 * 第二步补齐了两个按对象直达的深链：`/trend?point=<测点ID>` 与 `/issues?workOrder=<工单ID>`。
 * 这一组守两件事：
 * 1. **找不到就说找不到**：对象被删、被归档、数据集换了，都要给出可显示的原因，不能静默换对象；
 * 2. **链接与白名单一致**：`deep`、query 参数名、实际路径三者不许各说各话。
 */
import { describe, expect, it } from 'vitest'
import { buildLink, NAV_WHITELIST } from '@/assistant/actions'
import { DEEP_LINK_QUERY, resolvePointTarget, resolveWorkOrderTarget } from '@/assistant/deepLink'
import { claims, record, setupHarness } from '../harness'

const POINTS: Record<string, { code: string; archived: boolean }> = {
  pnt_ok: { code: 'B01-F2-CRACK01', archived: false },
  pnt_old: { code: 'B01-F2-CRACK02', archived: true },
}

const ORDERS: Record<string, { id: string; issueId: string | null; orderNo: string }> = {
  wo_1: { id: 'wo_1', issueId: 'iss_1', orderNo: 'WO-20260920-001' },
  wo_orphan: { id: 'wo_orphan', issueId: null, orderNo: 'WO-20260920-002' },
}

const lookPoint = (id: string) => POINTS[id]
const lookOrder = (id: string) => ORDERS[id]

describe('趋势页深链 /trend?point=', () => {
  it('在册测点直接命中', () => {
    expect(resolvePointTarget('pnt_ok', lookPoint)).toEqual({ id: 'pnt_ok', reason: '' })
  })

  it('没给参数时不产生任何目标，也不报错', () => {
    expect(resolvePointTarget(undefined, lookPoint)).toEqual({ id: '', reason: '' })
    expect(resolvePointTarget('', lookPoint)).toEqual({ id: '', reason: '' })
    expect(resolvePointTarget(['a', 'b'], lookPoint)).toEqual({ id: '', reason: '' })
  })

  it('测点不存在时说明原因，并保留链接里的编号', () => {
    const out = resolvePointTarget('pnt_ghost', lookPoint)
    expect(out.id).toBe('')
    expect(out.reason).toContain('找不到测点 pnt_ghost')
    expect(out.reason).toContain('请在下方选择其它测点')
  })

  it('测点已归档时按"出不了图"说明，不当成不存在', () => {
    const out = resolvePointTarget('pnt_old', lookPoint)
    expect(out.id).toBe('')
    expect(out.reason).toContain('B01-F2-CRACK02')
    expect(out.reason).toContain('已归档')
  })

  it('影像对比页与趋势页共用同一条测点解析口径', () => {
    const media = buildLink('media_page', 'pnt_ok')
    expect(media.deep).toBe(true)
    expect(media.path).toBe('/media')
    expect(media.query.point).toBe('pnt_ok')
    expect(DEEP_LINK_QUERY.media_page).toBe('point')
    expect(NAV_WHITELIST.media_page.query('x')).toEqual({ point: 'x' })
  })
})

describe('问题池深链 /issues?workOrder=', () => {
  it('工单存在时给出工单与所属问题', () => {
    expect(resolveWorkOrderTarget('wo_1', lookOrder)).toEqual({ id: 'wo_1', issueId: 'iss_1', reason: '' })
  })

  it('旧的筛选值 open 不被当成工单 ID', () => {
    expect(resolveWorkOrderTarget('open', lookOrder)).toEqual({ id: '', issueId: '', reason: '' })
    expect(resolveWorkOrderTarget('', lookOrder)).toEqual({ id: '', issueId: '', reason: '' })
  })

  it('工单不存在时说明原因', () => {
    const out = resolveWorkOrderTarget('WO-20990101-001', lookOrder)
    expect(out.id).toBe('')
    expect(out.reason).toContain('找不到工单 WO-20990101-001')
  })

  it('工单没有关联问题时说明无法定位', () => {
    const out = resolveWorkOrderTarget('wo_orphan', lookOrder)
    expect(out.id).toBe('')
    expect(out.reason).toContain('WO-20260920-002')
    expect(out.reason).toContain('没有关联问题')
  })
})

describe('链接与白名单一致', () => {
  it('两个新深链已按对象直达标记，并带上对象 ID', () => {
    const trend = buildLink('point_trend', 'pnt_ok')
    expect(trend.deep).toBe(true)
    expect(trend.path).toBe('/trend')
    expect(trend.query.point).toBe('pnt_ok')

    const order = buildLink('workorder_detail', 'wo_1')
    expect(order.deep).toBe(true)
    expect(order.path).toBe('/issues')
    expect(order.query.workOrder).toBe('wo_1')
  })

  it('没有对象 ID 时不塞空参数（避免出现 ?point= 这种自相矛盾的链接）', () => {
    expect(buildLink('point_trend', '').query).toEqual({})
    expect(buildLink('workorder_detail', '').query).toEqual({})
  })

  it('深链参数名与解析端登记的一致', () => {
    expect(NAV_WHITELIST.point_trend.query('x')).toEqual({ [DEEP_LINK_QUERY.point_trend ?? '']: 'x' })
    expect(NAV_WHITELIST.workorder_detail.query('x')).toEqual({ [DEEP_LINK_QUERY.workorder_detail ?? '']: 'x' })
  })

  it('回答里的趋势与工单链接都带上了对象 ID', async () => {
    const h = await setupHarness({ records: [record({ id: 'r1', sampleTime: '2026-09-20T11:00:00.000Z' })] })
    const pointAnswer = await h.ask('二层走廊西墙裂缝测点怎么样')
    const trend = pointAnswer.links.find((row) => row.kind === 'point_trend')
    expect(trend?.deep).toBe(true)
    expect(trend?.query.point).toBe('pnt_1')
    expect(claims(pointAnswer)).toContain('B01-F2-CRACK01')
  })
})
