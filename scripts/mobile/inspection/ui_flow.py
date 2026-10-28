"""Exercise real native inspection forms against the isolated HTTP service."""

import argparse
import json
import re
import sys
from pathlib import Path
from urllib.parse import quote

from http_api import Api, EVIDENCE, RUNTIME, fixture, save

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from verification import playful as p


def capture(name):
    return p.ui.capture(p.OPTIONS, EVIDENCE / 'page' / name)


def show(fragment, direction='up'):
    for _ in range(6):
        rows = p.ui.observe(p.OPTIONS)
        if any(fragment in text for text in p.texts(rows)):
            return rows
        boxes = [list(map(int, re.findall(r'-?\d+', row['bounds']))) for row in rows
                 if row.get('type') == 'Scroll' and row.get('visible') == 'true']
        left, top, right, bottom = max(boxes, key=lambda box: (box[2] - box[0]) * (box[3] - box[1]))
        x = str((left + right) // 2)
        start, end = (0.25, 0.8) if direction == 'up' else (0.8, 0.25)
        p.ui.command(p.OPTIONS, 'shell', 'uitest', 'uiInput', 'swipe', x, str(int(top + (bottom - top) * start)),
                     x, str(int(top + (bottom - top) * end)))
    raise ValueError(f'Native text was not revealed: {fragment}')


def task(api, task_id):
    return next(row for row in api.data('/inspection/tasks') if row['id'] == task_id)


def back():
    rows = p.ui.observe(p.OPTIONS)
    button = next(row for row in rows if 'BackButton' in row.get('id', '') and row.get('visible') == 'true')
    p.click(button['id'])


def connect(address):
    p.click('tab-3')
    show('校园服务连接')
    rows = p.ui.observe(p.OPTIONS)
    settings = [row for row in rows if row.get('id') == 'service-settings' and row.get('visible') == 'true']
    if settings[0].get('text') == '设置':
        p.click('service-settings', 'up')
    p.ui.replace_text(p.OPTIONS, 'service-address', address)
    p.click('connect-service')
    p.expect('已连接')


def open_task(task_id):
    rows = p.ui.observe(p.OPTIONS)
    if any('BackButton' in row.get('id', '') and row.get('visible') == 'true' for row in rows):
        back()
    p.click('tab-2')
    p.click(f'inspection-task-{task_id}')
    p.expect('FIELD NOTE')


def setup():
    connect('http://127.0.0.1:18084')
    p.click('tab-3')
    p.click('identity-demo-inspector')
    p.click('tab-0')
    p.expect('巡检人员')
    p.click('tab-2')
    capture('tasks-ready')
    return {'connectedTo': 'Isolated API through 18004 proxy', 'identity': 'demo-inspector'}


def arrival():
    api, data = Api(), fixture()
    try:
        task_id, point = data['tasks'][0]['id'], data['points'][0]
        open_task(task_id)
        capture('task-detail')
        p.ui.replace_text(p.OPTIONS, 'arrival-label', 'WRONG-TAG', 'down')
        p.click('inspection-check-in')
        show('标签编号不一致')
        capture('wrong-tag')
        wrong = task(api, task_id)
        assert wrong['results'][0]['status'] == 'pending' and len(wrong['results'][0]['attempts']) == 1
        p.click('arrival-manual')
        p.click('arrival-use-label')
        p.click('inspection-check-in')
        show('人工签到必须填写原因')
        capture('manual-no-reason')
        assert task(api, task_id)['rev'] == wrong['rev']
        p.ui.replace_text(p.OPTIONS, 'arrival-reason', '标签损坏后人工核对登记编号', 'down')
        p.click('inspection-check-in')
        show('到点核对通过')
        capture('arrived')
        arrived = task(api, task_id)
        assert arrived['status'] == 'pending' and arrived['results'][0]['status'] == 'arrived'
        p.click('inspection-complete')
        show('请完成全部必答检查项')
        capture('missing-required')
        assert task(api, task_id)['rev'] == arrived['rev']
        return {'wrongTagSavedAsFailed': True, 'manualMissingReasonBlocked': True,
                'arrivedIsNotCompleted': True, 'missingRequiredBlocked': True, 'task': arrived}
    finally:
        api.close()


def completion():
    api, data = Api(), fixture()
    try:
        task_id = data['tasks'][0]['id']
        p.click('answer-wall-abnormal')
        p.click('answer-passage-ok')
        before = task(api, task_id)
        p.click('inspection-complete')
        show('存在异常')
        capture('abnormal-no-basis')
        assert task(api, task_id)['rev'] == before['rev']
        p.ui.replace_text(p.OPTIONS, 'inspection-no-issue-reason', '验收模拟的旧修补痕迹已核查稳定无需另建问题', 'down')
        p.click('inspection-complete')
        show('本测点已完成')
        first = task(api, task_id)
        assert first['status'] == 'partial' and first['results'][0]['status'] == 'completed'
        show('已完成 1 / 2 处')
        capture('partial')
        p.click(f'task-point-{data["points"][1]["id"]}', 'up')
        p.click('arrival-use-label')
        p.click('inspection-check-in')
        show('到点核对通过')
        p.click('answer-wall-ok')
        p.click('answer-passage-ok')
        p.click('inspection-complete')
        show('全部测点已检查完成')
        completed = task(api, task_id)
        assert completed['status'] == 'checked' and all(row['status'] == 'completed' for row in completed['results'])
        show('已完成 2 / 2 处')
        capture('checked')
        back()
        p.ui.command(p.OPTIONS, 'shell', 'aa', 'force-stop', p.ui.BUNDLE)
        p.ui.command(p.OPTIONS, 'shell', 'aa', 'start', '-a', 'EntryAbility', '-b', p.ui.BUNDLE)
        p.expect('已连接')
        open_task(task_id)
        show('已完成 2 / 2 处')
        capture('restart-checked')
        back()
        return {'abnormalMissingBasisBlocked': True, 'partialThenChecked': True,
                'restartRestoredServerTask': True, 'task': completed}
    finally:
        api.close()


def conflict():
    api, data = Api(), fixture()
    try:
        task_id, point = data['tasks'][1]['id'], data['points'][0]
        open_task(task_id)
        p.click('arrival-use-label')
        current = task(api, task_id)
        path = f'/inspection/tasks/{quote(task_id, safe="")}/check-in'
        api.data(path, {'expectedRev': current['rev'], 'pointId': point['id'], 'method': 'nfc',
                        'labelRead': point['nfc']['code'], 'fallbackReason': ''}, 'inspector')
        p.click('inspection-check-in')
        show('对象已被其他操作修改')
        capture('revision-conflict')
        p.click('inspection-reload')
        show('采用当前版本')
        capture('reload-keeps-draft')
        p.click('inspection-use-revision')
        p.click('answer-wall-ok')
        p.click('answer-passage-ok')
        p.click('inspection-complete')
        show('本测点已完成')
        capture('conflict-resolved')
        p.click(f'task-point-{data["points"][1]["id"]}', 'up')
        p.click('arrival-use-label')
        return {'oldRevisionRejected': True, 'explicitReloadAndAdopt': True}
    finally:
        api.close()


def retry():
    api, data = Api(), fixture()
    try:
        task_id = data['tasks'][1]['id']
        path = f'/api/v1/datasets/demo-main/inspection/tasks/{quote(task_id, safe="")}/check-in'
        save(RUNTIME / 'drop-response.json', {'path': path})
        before = task(api, task_id)
        p.click('inspection-check-in')
        show('结果未知', 'up')
        capture('unknown-response')
        committed = task(api, task_id)
        assert committed['rev'] == before['rev'] + 1
        from verify_http import ledger
        committed_ledger = ledger(task_id)
        p.click('inspection-retry')
        show('到点核对通过')
        capture('same-request-retry')
        after = task(api, task_id)
        assert after == committed and ledger(task_id) == committed_ledger
        back()
        return {'responseDroppedAfterCommit': True, 'retryDidNotAddAttemptOrRevision': True,
                'dropped': json.loads((RUNTIME / 'dropped-response.json').read_text()),
                'ledger': committed_ledger, 'task': after}
    finally:
        api.close()


def readonly():
    p.click('tab-3')
    p.click('identity-demo-property', 'up')
    p.click('tab-0')
    p.expect('物业值班人员')
    open_task(fixture()['tasks'][0]['id'])
    show('当前身份可查看任务', 'down')
    rows = capture('readonly-property')
    assert not any(row.get('id') in ['inspection-check-in', 'inspection-complete'] for row in rows)
    back()
    return {'propertyCanReadButCannotExecuteInspectorTask': True}


def finish():
    connect('http://127.0.0.1:18080')
    p.click('tab-3')
    p.click('identity-demo-safety')
    p.click('tab-0')
    p.expect('学校安全管理人员')
    capture('delivery-home')
    return {'deliveryEndpointRestored': True, 'finalIdentity': 'demo-safety'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=['setup', 'arrival', 'completion', 'conflict', 'retry', 'readonly', 'finish'])
    phase = parser.parse_args().phase
    result = globals()[phase]()
    save(EVIDENCE / 'verification/ui' / f'{phase}.json', result)
    print(json.dumps({'phase': phase, 'verified': True}, ensure_ascii=True))
