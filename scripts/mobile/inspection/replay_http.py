"""Recheck a real native receipt after temporary fixture-only authorization changes."""

import json
import sqlite3
from urllib.parse import quote

from http_api import Api, EVIDENCE, RUNTIME, fixture, save
from verify_http import ledger


def fixture_state(point_id):
    connection = sqlite3.connect(RUNTIME / 'api/zhutong.sqlite')
    try:
        actor = connection.execute('select role,building_ids_json from users where id=?', ('demo-inspector',)).fetchone()
        point = connection.execute('select status from points where dataset_id=? and id=?', ('demo-main', point_id)).fetchone()
        return {'role': actor[0], 'scope': actor[1], 'status': point[0]}
    finally:
        connection.close()


def configure(point_id, state):
    connection = sqlite3.connect(RUNTIME / 'api/zhutong.sqlite')
    try:
        with connection:
            connection.execute('update users set role=?,building_ids_json=? where id=?',
                               (state['role'], state['scope'], 'demo-inspector'))
            connection.execute('update points set status=? where dataset_id=? and id=?',
                               (state['status'], 'demo-main', point_id))
    finally:
        connection.close()


def run():
    api, data = Api(), fixture()
    previous = json.loads((EVIDENCE / 'verification/ui/retry.json').read_text(encoding='utf-8'))
    task_id, point = data['tasks'][1]['id'], data['points'][1]
    path = f'/inspection/tasks/{quote(task_id, safe="")}/check-in'
    key = previous['dropped']['idempotencyKey']
    body = {'expectedRev': previous['task']['rev'] - 1, 'pointId': point['id'],
            'method': 'nfc', 'labelRead': point['nfc']['code'], 'fallbackReason': ''}
    original, before = fixture_state(point['id']), ledger(task_id)
    results = []
    try:
        status, response = api.call(path, body, 'inspector', key)
        assert status == 200 and response['replayed'] is True
        for change, expected in [('scope', 403), ('role', 403), ('archived', 404)]:
            state = dict(original)
            state['scope' if change == 'scope' else 'role' if change == 'role' else 'status'] = (
                '[]' if change == 'scope' else 'property' if change == 'role' else 'archived')
            configure(point['id'], state)
            status, denied = api.call(path, body, 'inspector', key)
            assert status == expected, (change, status, denied)
            assert ledger(task_id) == before
            results.append({'change': change, 'status': status, 'code': denied['error']['code']})
            configure(point['id'], original)
        status, response = api.call(path, body, 'inspector', key)
        assert status == 200 and response['replayed'] is True and ledger(task_id) == before
        result = {'scope': 'Isolated fixture only; restored in finally', 'checks': results,
                  'authorizedOriginalRevisionReplay': True, 'noExtraAuditOrReceipt': True, 'ledger': before}
        save(EVIDENCE / 'verification/replay-auth.json', result)
        print(json.dumps(result, ensure_ascii=True))
    finally:
        configure(point['id'], original)
        api.close()


if __name__ == '__main__':
    run()
