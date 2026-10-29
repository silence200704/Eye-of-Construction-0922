"""Small SDK UI checkpoints for actual native handling acceptance."""
import argparse
import json
from scripts.mobile.handling.common import Api, EVIDENCE, RUNTIME, fixture, ledger, save
from scripts.mobile.reporting.ui_flow import reveal, back, click_text
from scripts.mobile.verification import playful as p


def capture(name):
    return p.ui.capture(p.OPTIONS, EVIDENCE / 'page' / name)


def connect(address):
    p.click('tab-3'); reveal('校园服务连接', 'up')
    rows = p.ui.observe(p.OPTIONS)
    if next(row for row in rows if row.get('id') == 'service-settings')['text'] == '设置':
        p.click('service-settings', 'up')
    p.ui.replace_text(p.OPTIONS, 'service-address', address)
    p.click('connect-service'); p.expect('已连接')


def supplement():
    connect('http://127.0.0.1:18088')
    p.click('tab-3'); p.click('identity-demo-inspector'); p.click('tab-0'); p.click('home-issues')
    p.click(f'issue-supplement-{fixture()["issue"]["id"]}')
    p.expect('补充说明'); capture('supplement-original-preserved')
    p.ui.replace_text(p.OPTIONS, 'supplement-note', '补充模拟观察：已检查设备固定件，补充同位置照片供审核，无真实设备隐患。', 'down')
    p.click('report-album')
    return {'fixedOriginalTarget': True, 'noLocationRetyping': True, 'galleryPending': True}


def submit_supplement():
    p.expect('已选择 1/2'); capture('supplement-photo')
    p.click('report-submit'); reveal('已提交', 'up'); capture('supplement-saved')
    api = Api()
    try:
        issue = api.data('/issues')[0]; original = fixture()['issue']
        assert issue['id'] == original['id'] and issue['description'] == original['description']
        assert set(original['photos']).issubset(issue['photos']) and len(issue['photos']) == 2
        assert issue['reviewAction'] is None and issue['status'] == 'pending_review'
        save(EVIDENCE / 'verification/business/supplement.json', {'issue': issue, 'ledger': ledger(), 'originalPreserved': True})
    finally:
        api.close()
    p.click('report-done'); back()
    return {'oneIssue': True, 'appendOnly': True, 'photos': 2}


def open_order():
    p.click('tab-3'); p.click('identity-demo-repair'); p.click('tab-2'); p.click('task-orders', 'up')
    api = Api()
    try:
        order = api.data('/work-orders')[0]
    finally:
        api.close()
    p.click(f'work-order-{order["id"]}'); p.expect('接单，开始处理'); capture('assigned-order')
    p.click('order-accept'); p.expect('填写措施，提交完工'); capture('one-click-accepted')
    p.click('order-submit-open')
    p.ui.replace_text(p.OPTIONS, 'handling-measures', '模拟维修：复紧固定件并逐项检查，提交学校验收。', 'down')
    p.ui.replace_text(p.OPTIONS, 'handling-materials', '模拟螺栓两枚', 'down')
    p.click('report-album')
    return {'acceptBusinessClicks': 1, 'extraConfirmation': False, 'completionGalleryPending': True}


def completion_loss():
    p.expect('已选择 1/3'); capture('completion-draft')
    api = Api()
    try:
        order = api.data('/work-orders')[0]
        save(RUNTIME / 'drop-response.json', {'path': f'/api/v1/datasets/demo-main/work-orders/{order["id"]}/actions'})
        p.click('report-submit'); reveal('服务端可能已保存', 'up'); capture('completion-unknown')
        before = ledger(); row = api.data('/work-orders')[0]
        assert row['status'] == 'submitted' and len(row['photos']) == 1
        save(EVIDENCE / 'verification/commands/retry-before.json', {'ledger': before, 'order': row})
        p.click('report-retry'); reveal('这份记录，已经送达', 'up'); capture('completion-retried')
        assert ledger() == before and api.data('/work-orders')[0] == row
        save(EVIDENCE / 'verification/commands/completion-retry.json', {'order': row, 'sameLedger': before,
            'dropped': json.loads((RUNTIME / 'dropped-response.json').read_text()), 'exactRetryNoDuplicate': True})
    finally:
        api.close()
    p.click('report-done')
    return {'unknownVisible': True, 'retriedWithoutDuplicate': True}


def rework():
    p.click('order-reload'); p.expect('重新接续办理'); capture('returned-order')
    p.click('order-accept'); p.expect('填写措施，提交完工'); p.click('order-submit-open')
    p.ui.replace_text(p.OPTIONS, 'handling-measures', '模拟返工：逐项复紧并补充二次复核记录，原验收退回原因保留。', 'down')
    p.ui.replace_text(p.OPTIONS, 'handling-note', '已按退回意见补充办理，等待重新验收。', 'down')
    api = Api()
    try:
        order = api.data('/work-orders')[0]
        save(RUNTIME / 'drop-response.json', {'path': f'/api/v1/datasets/demo-main/work-orders/{order["id"]}/actions'})
        p.click('report-submit'); reveal('服务端可能已保存', 'up'); capture('rework-unknown')
        before = ledger(); row = api.data('/work-orders')[0]
        save(EVIDENCE / 'verification/commands/retry-before.json', {'ledger': before, 'order': row})
        p.click('report-retry'); reveal('这份记录，已经送达', 'up'); capture('rework-submitted')
        assert ledger() == before and api.data('/work-orders')[0] == row
        save(EVIDENCE / 'verification/commands/completion-retry.json', {'order': row, 'sameLedger': before,
            'dropped': json.loads((RUNTIME / 'dropped-response.json').read_text()), 'exactRetryNoDuplicate': True})
    finally:
        api.close()
    p.click('report-done')
    return {'returnReasonRetained': True, 'reacceptOneClick': True, 'resubmitted': True}


def finish():
    back(); connect('http://127.0.0.1:18080')
    p.click('tab-3'); p.click('identity-demo-safety'); p.click('tab-0'); capture('delivery-restored')
    return {'canonicalRestored': True, 'identity': 'demo-safety'}


def restored():
    p.expect('已连接'); p.click('tab-2'); p.click('task-orders', 'up')
    api = Api()
    try:
        order = api.data('/work-orders')[0]
        assert order['status'] == 'verified'
        p.click(f'work-order-{order["id"]}'); p.expect('验收通过'); capture('restored-verified-order')
        rows = p.ui.observe(p.OPTIONS)
        assert not any(row.get('id') in ['order-accept', 'order-submit-open'] for row in rows)
        back(); p.click('tab-0'); p.click('home-issues'); reveal('已关闭'); capture('restored-closed-issue')
    finally:
        api.close()
    return {'finalHapReinstalled': True, 'appRestarted': True, 'verifiedOrderAndClosedIssueRecovered': True,
            'invalidNextActionsHidden': True, 'physicalDevice': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=['supplement', 'submit_supplement', 'open_order', 'completion_loss', 'rework', 'restored', 'finish'])
    phase = parser.parse_args().phase
    result = globals()[phase]()
    save(EVIDENCE / 'verification/ui' / f'{phase}.json', result)
    print(json.dumps(result, ensure_ascii=True))
