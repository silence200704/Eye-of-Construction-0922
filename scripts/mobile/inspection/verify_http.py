"""Verify authoritative inspection rules, audit/receipt replay and delivery-data isolation."""

import hashlib
import json
import sqlite3
from urllib.parse import quote

from http_api import Api, EVIDENCE, RUNTIME, fixture, save


def ledger(task_id):
    with sqlite3.connect(f'file:{(RUNTIME / "api/zhutong.sqlite").as_posix()}?mode=ro', uri=True) as connection:
        audits = connection.execute('select count(*) from audits where object_id=?', (task_id,)).fetchone()[0]
        receipts = connection.execute("select count(*) from operation_receipts where json_extract(response,'$.task.id')=?", (task_id,)).fetchone()[0]
    return {'audits': audits, 'receipts': receipts}


def server_rules(api):
    data = fixture()
    points = data['points']
    plan = api.data('/inspection/plans', {'name': '原生接口规则验收', 'kind': 'patrol',
        'buildingId': data['building']['id'], 'floorIds': [points[0]['floorId']],
        'pointIds': [point['id'] for point in points], 'cycle': {'unit': 'day', 'interval': 1, 'atTime': '11:00'},
        'startDate': '2026-10-28', 'owner': '验收', 'executorRole': 'inspector', 'enabled': True,
        'checklist': [{'key': 'wall', 'label': '墙面', 'required': True}]})
    api.data('/inspection/tasks/generate', {'date': '2026-10-28'})
    task = next(row for row in api.data('/inspection/tasks') if row['planId'] == plan['id'])
    target = f'/inspection/tasks/{quote(task["id"], safe="")}'
    arrival = {'expectedRev': task['rev'], 'pointId': points[0]['id'], 'method': 'manual',
               'labelRead': points[0]['nfc']['code'], 'fallbackReason': ''}
    denied, error = api.call(f'{target}/check-in', arrival, 'property')
    assert denied == 403 and error['error']['code'] == 'ROLE_FORBIDDEN'
    missing = api.data(f'{target}/check-in', arrival, 'inspector')
    assert missing['attempt']['passed'] is False
    task = missing['task']
    complete = {'expectedRev': task['rev'], 'pointId': points[0]['id'], 'answers': [],
                'linkedIssueId': None, 'noIssueReason': ''}
    status, before = api.call(f'{target}/complete-point', complete, 'inspector')
    assert status == 422 and before['error']['code'] == 'CHECK_INCOMPLETE'
    arrived = api.data(f'{target}/check-in', {**arrival, 'expectedRev': task['rev'], 'fallbackReason': '标签损坏，现场人工核对'}, 'inspector')
    task = arrived['task']
    assert arrived['attempt']['passed'] is True and task['status'] == 'pending'
    complete['expectedRev'] = task['rev']
    status, missing_answers = api.call(f'{target}/complete-point', complete, 'inspector')
    assert status == 422
    complete['answers'] = [{'key': 'wall', 'result': 'abnormal', 'note': '验收异常分支'}]
    status, no_basis = api.call(f'{target}/complete-point', complete, 'inspector')
    assert status == 422
    complete['linkedIssueId'] = 'not-a-task-issue'
    status, unrelated = api.call(f'{target}/complete-point', complete, 'inspector')
    assert status == 422
    complete.update({'answers': [{'key': 'wall', 'result': 'ok', 'note': '已检查'}], 'linkedIssueId': None})
    written = api.data(f'{target}/complete-point', complete, 'inspector', 'native-http-complete-stable')
    first = ledger(task['id'])
    replay = api.data(f'{target}/complete-point', complete, 'inspector', 'native-http-complete-stable')
    assert replay == written and ledger(task['id']) == first
    assert written['task']['status'] == 'partial'
    return {'wrongRole403': denied, 'manualWithoutReasonPassed': missing['attempt']['passed'],
            'beforeArrival': status_code(before), 'missingRequired': status_code(missing_answers),
            'abnormalWithoutBasis': status_code(no_basis), 'unrelatedIssue': status_code(unrelated),
            'idempotentReplayNoExtraAuditOrReceipt': True, 'ledger': first, 'task': written['task']}


def status_code(response):
    return response['error']['code']


def delivery_snapshot():
    api = Api()
    api.base = 'http://127.0.0.1:8080/api/v1'
    try:
        archive = api.data('/archive')
        objects = {'archive': archive}
        counts = {'buildings': len(archive['buildings']), 'points': len(archive['points'])}
        for key, path in [('records', '/records'), ('events', '/events?status=all'),
                          ('tasks', '/inspection/tasks'), ('orders', '/work-orders')]:
            rows = api.data(path)
            objects[key] = rows
            counts[key] = len(rows)
        return {'counts': counts, 'businessSha256': hashlib.sha256(json.dumps(objects, sort_keys=True).encode()).hexdigest()}
    finally:
        api.close()


if __name__ == '__main__':
    client = Api()
    try:
        result = server_rules(client)
        save(EVIDENCE / 'verification/http.json', result)
        print(json.dumps({key: value for key, value in result.items() if key != 'task'}, ensure_ascii=True))
    finally:
        client.close()
