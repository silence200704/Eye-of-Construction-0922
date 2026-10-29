"""Real HTTP, media and restart assertions against the isolated handling instance."""
import argparse
import hashlib
import json
import sqlite3
import urllib.error
import urllib.request
from scripts.mobile.handling.common import Api, EVIDENCE, RUNTIME, fixture, ledger, save


def read(name):
    return json.loads((EVIDENCE / 'verification' / name).read_text(encoding='utf-8'))


def business(api):
    return {path: api.data(path) for path in ['/issues', '/work-orders', '/attachments']}


def closed():
    api = Api()
    try:
        rows = business(api); issue = rows['/issues'][0]; order = rows['/work-orders'][0]
        assert len(rows['/issues']) == len(rows['/work-orders']) == 1
        assert issue['status'] == 'closed' and order['status'] == 'verified'
        assert issue['description'] == fixture()['issue']['description'] and len(issue['photos']) == 2
        assert len(order['photos']) == 1 and len(order['reviews']) == 2
        assert [r['result'] for r in order['reviews']] == ['fail', 'pass']
        hashes = []
        for attachment in rows['/attachments']:
            role = 'repair' if attachment['workOrderId'] else 'inspector'
            metadata = api.data(f'/media/{attachment["mediaId"]}', role=role)
            downloads = {}
            for identity in [role, 'safety']:
                request = urllib.request.Request(f'{api.base}/datasets/demo-main/media/{metadata["id"]}/content',
                    headers={'Authorization': f'Bearer {api.token(identity)}'})
                with urllib.request.urlopen(request, timeout=15) as response:
                    content = response.read()
                assert len(content) == metadata['size']
                downloads[identity] = hashlib.sha256(content).hexdigest()
            assert all(digest == metadata['sha256'] for digest in downloads.values())
            hashes.append({'attachmentId': attachment['id'], 'media': metadata, 'downloadSha256': downloads})
        result = {'rows': rows, 'ledger': ledger(), 'media': hashes,
                  'verifiedWasPendingRecheck': read('business/verified.json')['issue']['status'] == 'pending_recheck'}
        save(EVIDENCE / 'verification/business/closed.json', result)
        return {'issueClosedAfterRecheck': True, 'orderVerified': True, 'photosCrossRead': len(hashes)}
    finally:
        api.close()


def change_user(**fields):
    with sqlite3.connect(RUNTIME / 'api/zhutong.sqlite') as db:
        for name, value in fields.items():
            assert name in ['role', 'building_ids_json']
            db.execute(f'update users set {name}=? where id=?', (value, 'demo-repair'))


def guards():
    api = Api()
    result = {}
    try:
        record = read('commands/completion-retry.json'); order = record['order']; key = record['dropped']['key']
        body = {'expectedRev': order['rev'] - 1, 'note': order['timeline'][-1]['detail'], 'photos': [],
                'to': 'submitted', 'measures': order['measures'], 'materials': order['materials']}
        path = f'/work-orders/{order["id"]}/actions'; before = ledger()
        status, replay = api.call(path, body, 'repair', key)
        assert status == 200 and replay['replayed'] and replay['data']['order'] == order
        assert api.data('/work-orders')[0]['status'] == 'verified' and ledger() == before
        result['authorizedStaleReplay'] = {'status': status, 'sameLedger': True, 'currentStillVerified': True}
        status, response = api.call(path, {**body, 'note': 'changed'}, 'repair', key)
        assert status == 409 and response['error']['code'] == 'IDEMPOTENCY_CONFLICT'
        result['differentPayload'] = status
        change_user(building_ids_json='[]')
        assert api.data('/work-orders', role='repair') == []
        status, _ = api.call(path, body, 'repair', key); assert status == 403
        result['scopeRevokedReplay'] = status
        status, _ = api.call(f'/work-orders/{order["id"]}/handling-context', role='repair'); assert status == 403
        result['scopeRevokedContext'] = status
        change_user(building_ids_json=None, role='inspector')
        status, _ = api.call(path, body, 'repair', key); assert status == 409
        result['roleRevokedReplay'] = status
        status, _ = api.call(f'/issues/{fixture()["issue"]["id"]}/supplement-context'); assert status == 403
        result['nonOriginalReporter'] = status
        assert ledger() == before
        save(EVIDENCE / 'verification/commands/guards.json', {'checks': result, 'sameLedger': before})
        return result
    finally:
        change_user(building_ids_json=None, role='repair')
        api.close()


def restart():
    api = Api()
    try:
        actual = business(api)
        assert actual == read('business/closed.json')['rows']
        save(EVIDENCE / 'verification/runtime/after-restart.json', {'sameBusinessRows': True, 'rows': actual})
        return {'sameBusinessRows': True}
    finally:
        api.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=['closed', 'guards', 'restart'])
    print(json.dumps(globals()[parser.parse_args().phase](), ensure_ascii=True))
