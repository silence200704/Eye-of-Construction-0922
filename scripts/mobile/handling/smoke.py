"""Accept and complete one extra isolated order using the final signed HAP."""
import argparse
import json
from scripts.mobile.handling.common import Api, EVIDENCE, fixture, save
from scripts.mobile.handling.ui_flow import capture, connect, reveal, p


def prepare():
    api = Api()
    try:
        order = api.data('/work-orders', {'title': '最终HAP无照片最短流程验收', 'pointId': fixture()['point']['id'],
            'note': '独立模拟数据，用于最新回执完整性校验后的原生写入冒烟。'}, key='final-hap-smoke-order')['order']
        order = api.data(f'/work-orders/{order["id"]}/actions', {'expectedRev': order['rev'],
            'to': 'assigned', 'assigneeId': 'demo-repair'}, key='final-hap-smoke-assign')['order']
        save(EVIDENCE / 'verification/business/final-smoke-order.json', order)
        return {'orderId': order['id']}
    finally:
        api.close()


def run():
    connect('http://127.0.0.1:18088'); p.click('tab-3'); p.click('identity-demo-repair')
    p.click('tab-2'); p.click('task-orders', 'up')
    order = json.loads((EVIDENCE / 'verification/business/final-smoke-order.json').read_text(encoding='utf-8'))
    p.click(f'work-order-{order["id"]}'); p.click('order-accept'); p.expect('填写措施，提交完工')
    capture('final-hap-one-click-accept'); p.click('order-submit-open')
    p.ui.replace_text(p.OPTIONS, 'handling-measures', '模拟最短流程：复紧并完成逐项检查。', 'down')
    p.click('report-submit'); reveal('这份记录，已经送达', 'up'); capture('final-hap-text-completion')
    p.click('report-done')
    api = Api()
    try:
        actual = next(row for row in api.data('/work-orders') if row['id'] == order['id'])
        assert actual['status'] == 'submitted' and actual['acceptedById'] == 'demo-repair'
        assert actual['photos'] == [] and actual['materials'] == ''
        final = api.data(f'/work-orders/{actual["id"]}/actions', {'expectedRev': actual['rev'],
            'to': 'verified', 'note': '最终HAP原生文字完工验收通过。'}, key='final-hap-smoke-verify')['order']
        save(EVIDENCE / 'verification/business/final-smoke-result.json', {'order': final, 'submittedByFinalHap': True,
            'minimumRequiredFields': ['measures'], 'acceptBusinessClicks': 1, 'optionalPhotosOmitted': True,
            'finalSmokeVerification': 'HTTP safety command; main scenario Web verification captured separately'})
    finally:
        api.close()
    return {'nativeFinalHapAcceptAndComplete': True, 'optionalPhotosOmitted': True}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=['prepare', 'run'])
    print(json.dumps(globals()[parser.parse_args().phase](), ensure_ascii=True))
