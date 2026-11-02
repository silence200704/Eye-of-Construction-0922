"""Native alert acknowledge / investigate / recover / close acceptance."""
import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import review_ui as r

FIXTURE = json.loads((r.ROOT / 'docs/implementation/evidence/stage8-online-completion/verification/business/fixture.json')
                     .read_text(encoding='utf-8'))
EVENT = FIXTURE['crackEvent']['id']
POINT = FIXTURE['points']['crack']['point']['id']


def at(minutes):
    return (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat()


def event(token):
    return next(row for row in r.data('/events', token) if row['id'] == EVENT)


def state(token):
    row = event(token)
    counts = r.db_counts()
    return {'status': row['status'], 'rev': row['rev'], 'acknowledgedBy': row['acknowledgedBy'],
            'timeline': row['timeline'], 'closeBasis': row['closeBasis'],
            'audits': counts['audits'], 'receipts': counts['operation_receipts'],
            'notifications': notification_state(token)}


def notification_state(token):
    notes = r.data('/notifications', token)
    return [{'id': row['id'], 'eventId': row.get('eventId'), 'acknowledgedAt': row.get('acknowledgedAt'),
             'acknowledgedBy': row.get('acknowledgedBy')} for row in notes if row.get('eventId') == EVENT]


def open_event():
    r.click('tab-1')
    r.click('filter-crack', 'up')
    r.click(f'alarm-{EVENT}')


def phase_pre():
    token = r.session('safety')
    try:
        result = {'event': event(token), 'state': state(token), 'db': r.db_counts(),
                  'epoch': r.data('/archive', token)['epoch'], 'point': POINT,
                  'capturedAt': r.stamp()}
        r.save('verification/alerts/pre.json', result)
        print(json.dumps({'status': result['event']['status'], 'rev': result['event']['rev'], **result['db']}))
    finally:
        r.logout(token)


def phase_readonly():
    token = r.session('inspector')
    try:
        r.click('tab-3'); r.click('identity-demo-inspector'); r.click('tab-1')
        open_event()
        r.expect('把异常，认真接住')
        rows = r.capture('alerts/inspector-readonly')
        ids = {row.get('id') for row in rows}
        forbidden = [key for key in ['alarm-acknowledge', 'alarm-note-open', 'alarm-close-open'] if key in ids]
        r.save('verification/alerts/inspector-readonly.json',
               {'role': 'inspector', 'eventId': EVENT, 'forbiddenActionsVisible': forbidden,
                'visibleTexts': r.texts(rows)})
        r.back()
        print(json.dumps({'forbiddenVisible': forbidden}))
    finally:
        r.logout(token)


def phase_property():
    token = r.session('property')
    try:
        r.click('tab-3'); r.click('identity-demo-property'); r.click('tab-1')
        open_event()
        rows = r.capture('alerts/property-readonly')
        ids = {row.get('id') for row in rows}
        r.save('verification/alerts/property-readonly.json',
               {'role': 'property', 'eventId': EVENT,
                'ackVisible': 'alarm-acknowledge' in ids, 'noteVisible': 'alarm-note-open' in ids,
                'closeVisible': 'alarm-close-open' in ids, 'visibleTexts': r.texts(rows)})
        r.back()
        print(json.dumps({'ack': 'alarm-acknowledge' in ids, 'note': 'alarm-note-open' in ids,
                          'close': 'alarm-close-open' in ids}))
    finally:
        r.logout(token)


def phase_ack():
    token = r.session('safety')
    try:
        before = state(token)
        r.click('tab-3'); r.click('identity-demo-safety'); r.click('tab-1')
        open_event(); r.expect('确认预警，开始跟进')
        r.save(r.RUNTIME / 'drop-response.json',
               {'path': f'/api/v1/datasets/demo-main/events/{EVENT}/acknowledge'})
        r.click('alarm-acknowledge')
        r.expect('用原请求核验办理结果')
        r.capture('alerts/ack-unknown')
        after_drop = state(token)
        r.save('verification/alerts/ack-dropped.json', {'before': before, 'afterCommit': after_drop})
        r.click('alarm-retry')
        r.expect('服务端已保存本次办理')
        r.capture('alerts/ack-saved')
        after_retry = state(token)
        dropped = json.loads((r.RUNTIME / 'dropped-response.json').read_text(encoding='utf-8'))
        r.save('verification/alerts/ack-retry.json', {
            'before': before, 'afterDroppedResponse': after_drop, 'afterRetry': after_retry,
            'dropped': dropped,
            'sameAuditsAndReceipts': after_drop['audits'] == after_retry['audits'] and
            after_drop['receipts'] == after_retry['receipts'],
            'sameTimeline': after_drop['timeline'] == after_retry['timeline'],
            'noDuplicate': after_retry['rev'] == after_drop['rev']})
        print(json.dumps({'status': after_retry['status'], 'rev': after_retry['rev'],
                          'audits': after_retry['audits'], 'receipts': after_retry['receipts'],
                          'same': after_drop['audits'] == after_retry['audits']}))
    finally:
        r.logout(token)


def phase_note():
    token = r.session('safety')
    try:
        before = state(token)
        r.expect('登记排查 / 处置措施')
        r.click('alarm-note-open')
        r.replace('alarm-field-note', '短句')
        r.click('alarm-note-save')
        r.expect('至少10字')
        r.capture('alerts/note-too-short')
        short = state(token)
        r.replace('alarm-field-note', '比赛模拟现场排查：已核对测点与读数，设置现场提示并安排恢复复测。')
        r.click('alarm-note-save')
        r.expect('服务端已保存本次办理')
        r.capture('alerts/field-note-saved')
        after = state(token)
        event_after = event(token)
        r.save('verification/alerts/field-note.json', {'before': before, 'afterShortRejected': short,
                                                       'afterSaved': after,
                                                       'lastTimeline': event_after['timeline'][-1]})
        print(json.dumps({'shortRejected': short['rev'] == before['rev'],
                          'lastTimeline': event_after['timeline'][-1]['action']}))
    finally:
        r.logout(token)


def phase_close_guard():
    token = r.session('safety')
    try:
        row = event(token)
        epoch = r.data('/archive', token)['epoch']
        status, body = r.post(f'/datasets/demo-main/events/{EVENT}/close',
                              {'expectedRev': row['rev'], 'basis': '试图在恢复前关闭', 'noRepairNote': '模拟无需维修'},
                              token, f'review-close-guard-{row["rev"]}', epoch)
        r.save('verification/alerts/close-before-recovery.json',
               {'httpStatus': status, 'response': body, 'eventStatus': row['status'], 'rev': row['rev']})
        print(json.dumps({'httpStatus': status, 'code': body.get('error', {}).get('code'),
                          'message': body.get('error', {}).get('message')}))
    finally:
        r.logout(token)


def add_record(token, minutes, width):
    epoch = r.data('/archive', token)['epoch']
    return r.post('/datasets/demo-main/records',
                  {'pointId': POINT, 'values': {'width': width}, 'unit': 'mm', 'source': 'manual',
                   'quality': 'valid', 'sampleTime': at(minutes), 'note': '模拟恢复复测'},
                  token, f'review-recovery-{minutes}-{width}', epoch)


def phase_recover_two():
    token = r.session('safety')
    try:
        for minutes, width in [(-4, 0.51), (-2, 0.50)]:
            add_record(token, minutes, width)
        row = event(token)
        r.save('verification/alerts/recovery-two-records.json',
               {'status': row['status'], 'rev': row['rev'], 'timeline': row['timeline']})
        print(json.dumps({'statusAfterTwo': row['status'], 'rev': row['rev']}))
    finally:
        r.logout(token)


def phase_recover_three():
    token = r.session('safety')
    try:
        add_record(token, -1, 0.50)
        row = event(token)
        r.save('verification/alerts/recovery-three-records.json',
               {'status': row['status'], 'rev': row['rev'], 'timeline': row['timeline']})
        print(json.dumps({'statusAfterThree': row['status'], 'rev': row['rev']}))
    finally:
        r.logout(token)


def phase_close_form():
    token = r.session('safety')
    try:
        before = state(token)
        r.click('alarm-reload')
        r.expect('核查恢复并关闭')
        r.click('alarm-close-open')
        r.replace('alarm-close-basis', '已核对三次模拟恢复复测及现场观察，确认恢复。')
        r.click('alarm-close-save')
        r.reveal('无需维修', 'up')
        r.capture('alerts/close-note-required')
        rejected = state(token)
        r.replace('alarm-close-note', '模拟现场核查确认无需维修，继续观察并保留后续巡检安排。')
        r.click('alarm-close-save')
        r.reveal('服务端已保存本次办理', 'up')
        r.capture('alerts/event-closed')
        after = state(token)
        row = event(token)
        r.save('verification/alerts/close.json', {'before': before, 'afterRejectedMissingNote': rejected,
                                                  'afterClosed': after, 'event': row,
                                                  'timeline': row['timeline']})
        print(json.dumps({'status': row['status'], 'rev': row['rev'], 'closeBasis': row['closeBasis'],
                          'audits': after['audits'], 'receipts': after['receipts']}))
    finally:
        r.logout(token)


def phase_sound():
    token = r.session('safety')
    try:
        before = state(token)
        rows = r.reveal('声光模拟')
        r.capture('alerts/sound-idle')
        r.click('signal-preview')
        rows = r.expect('本机声光模拟')
        message = next((text for text in r.texts(rows) if '短音输出' in text or '提示音暂不可用' in text), '')
        if not message:
            rows = r.ui.wait_for(r.OPTIONS, lambda items: any(
                '短音输出' in text or '提示音暂不可用' in text for text in r.texts(items)))
            message = next(text for text in r.texts(rows) if '短音输出' in text or '提示音暂不可用' in text)
        r.capture('alerts/sound-playing')
        r.click('signal-preview')
        r.expect('模拟已停止')
        r.capture('alerts/sound-stopped')
        after = state(token)
        r.save('verification/alerts/sound.json', {'eventId': EVENT, 'message': message,
                                                  'statusBefore': before['status'], 'statusAfter': after['status'],
                                                  'revBefore': before['rev'], 'revAfter': after['rev'],
                                                  'stateChanged': before['status'] != after['status'] or before['rev'] != after['rev']})
        r.back()
        print(json.dumps({'message': message, 'stateChanged': before['rev'] != after['rev']}))
    finally:
        r.logout(token)


PHASES = {'pre': phase_pre, 'readonly': phase_readonly, 'property': phase_property, 'ack': phase_ack,
          'note': phase_note, 'close_guard': phase_close_guard, 'recover_two': phase_recover_two,
          'recover_three': phase_recover_three, 'close_form': phase_close_form, 'sound': phase_sound}

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('phase', choices=list(PHASES))
    PHASES[parser.parse_args().phase]()
