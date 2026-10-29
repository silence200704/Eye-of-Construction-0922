"""Native SDK acceptance of the remaining online monitoring workflows."""
import argparse
import json
from scripts.mobile.completion.common import Api, EVIDENCE, RUNTIME, fixture, save
from scripts.mobile.handling.ui_flow import connect
from scripts.mobile.reporting.ui_flow import reveal, back
from scripts.mobile.verification import playful as p


def capture(name):
    return p.ui.capture(p.OPTIONS, EVIDENCE / 'page' / name)


def open_event():
    connect('http://127.0.0.1:18090')
    p.click('tab-3'); p.click('identity-demo-safety'); p.click('tab-1')
    p.click('filter-crack', 'up')
    p.click(f'alarm-{fixture()["crackEvent"]["id"]}')
    p.expect('确认预警，开始跟进'); capture('pending-event')
    save(RUNTIME / 'drop-response.json', {'path': f'/api/v1/datasets/demo-main/events/{fixture()["crackEvent"]["id"]}/acknowledge'})
    p.click('alarm-acknowledge'); p.expect('用原请求核验办理结果'); capture('ack-unknown')
    p.click('alarm-retry'); p.expect('服务端已保存本次办理'); capture('ack-saved')
    p.click('alarm-note-open')
    p.ui.replace_text(p.OPTIONS, 'alarm-field-note', '比赛模拟现场排查：已核对测点与读数，设置现场提示并安排恢复复测。', 'down')
    p.click('alarm-note-save'); p.expect('服务端已保存本次办理'); capture('field-note')
    api = Api()
    try:
        event = next(r for r in api.data('/events') if r['id'] == fixture()['crackEvent']['id'])
        assert event['status'] == 'handling' and event['timeline'][-1]['action'] == '现场排查'
        save(EVIDENCE / 'verification/business/native-handling.json', event)
    finally:
        api.close()
    return {'ackResponseLossRetried': True, 'fieldNoteSaved': True}


def close_event():
    p.click('alarm-reload'); p.expect('核查恢复并关闭'); p.click('alarm-close-open')
    p.ui.replace_text(p.OPTIONS, 'alarm-close-basis', '已核对三次模拟恢复复测及现场观察，确认恢复。', 'down')
    p.ui.replace_text(p.OPTIONS, 'alarm-close-note', '模拟现场核查确认无需维修，继续观察并保留后续巡检安排。', 'down')
    p.click('alarm-close-save'); p.expect('服务端已保存本次办理'); capture('closed-event')
    api = Api()
    try:
        event = next(r for r in api.data('/events') if r['id'] == fixture()['crackEvent']['id'])
        assert event['status'] == 'closed'
        save(EVIDENCE / 'verification/business/native-closed.json', event)
    finally:
        api.close()
    back(); p.click('tab-1'); p.click('monitor-statistics', 'up')
    p.expect('触发 2 次预警'); capture('week-statistics'); p.click('stats-month'); p.expect('触发 2 次预警'); capture('month-statistics')
    return {'nativeClosedAfterRecovery': True, 'weekMonthVisible': True}


def finish():
    back(); connect('http://127.0.0.1:18080')
    p.click('tab-3'); p.click('identity-demo-safety'); p.click('tab-0'); capture('delivery-restored')
    return {'deliveryRestored': True}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=['open_event', 'close_event', 'finish'])
    phase = parser.parse_args().phase
    result = globals()[phase]()
    save(EVIDENCE / 'verification/ui' / f'{phase}.json', result)
    print(json.dumps(result))
