"""Isolated stage 7A/8 acceptance data, never writes to delivery."""
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from scripts.mobile.inspection.http_api import Api as BaseApi, save

ROOT = Path(__file__).resolve().parents[3]
RUNTIME = ROOT / 'backend/.runtime-stage8-finish'
EVIDENCE = ROOT / 'docs/implementation/evidence/stage8-online-completion'


class Api(BaseApi):
    def __init__(self):
        super().__init__()
        self.base = 'http://127.0.0.1:18010/api/v1'


def at(minutes):
    return (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat()


def fixture():
    return json.loads((EVIDENCE / 'verification/business/fixture.json').read_text(encoding='utf-8'))


def building(api, code, name):
    existing = next((r for r in api.data('/archive')['buildings'] if r['code'] == code), None)
    if existing:
        return existing
    return api.data('/buildings', {'code': code, 'name': name, 'purpose': '教学',
        'footprint': {'x': .3, 'y': .3, 'w': .2, 'h': .2, 'rotate': 0}})


def seed_point(api, context):
    kind, values, baseline, unit, metric, limits = context['spec']
    archive = api.data('/archive')
    point = next((r for r in archive['points'] if r['code'] == f'FINISH-{kind}'), None)
    point = point or api.data('/points', {'code': f'FINISH-{kind}', 'name': f'模拟{kind}监测站',
        'buildingId': context['building']['id'], 'floorId': context['floor']['id'],
        'type': kind, 'coord': {'x': .4, 'y': .4}, 'dataSource': 'demo'})
    device = next((r for r in archive['devices'] if r['pointId'] == point['id']), None)
    device = device or api.data('/devices', {'code': f'FINISH-{kind}-DEV', 'name': f'模拟{kind}传感器', 'pointId': point['id'], 'unit': unit})
    if kind != 'vibration' and not any(r['pointId'] == point['id'] for r in archive['baselines']):
        api.data('/baselines', {'pointId': point['id'], 'values': baseline, 'unit': unit,
            'reason': '隔离验收模拟基准', 'effectiveFrom': at(-1440)})
    if not any(r['code'] == f'FINISH-{kind}-RULE' for r in archive['rules']):
        api.data('/rules', {'code': f'FINISH-{kind}-RULE', 'name': '模拟监测分级', 'metric': metric, 'unit': unit,
            'thresholds': dict(zip(['yellow', 'orange', 'red'], limits)), 'rateThreshold': None,
            'effectiveFrom': at(-1440), 'enabled': True,
            'persistence': {'minRecords': 3, 'minSpanMinutes': 10, 'maxGapMinutes': 5, 'level': 'orange'},
            'recovery': {'yellowRatio': .8, 'minRecords': 3, 'minSpanMinutes': 0}})
    if not any(r['pointId'] == point['id'] for r in api.data('/records')):
        api.data('/records', {'pointId': point['id'], 'deviceId': device['id'], 'values': values, 'unit': unit,
            'source': 'device', 'quality': 'valid', 'sampleTime': at(-20), 'sampleWindow': '60秒统计（模拟）' if kind == 'vibration' else '',
            'note': '硬件输入模拟；非真实采集'})
    connection, battery = {'crack': ('online', 85), 'tilt': ('offline', 12), 'vibration': ('unknown', None)}[kind]
    device = api.data(f'/devices/{device["id"]}/simulation', {'expectedRev': device['rev'],
        'connection': connection, 'batteryPercent': battery, 'lastReportAt': at(-5) if battery else None})
    return {'point': point, 'device': device}


def seed():
    api = Api()
    try:
        main = building(api, 'FINISH-A', '小瞳守护教学楼')
        quiet = building(api, 'FINISH-B', '安静小院（空态验收）')
        existing = api.data('/archive')['floors']
        floors = [next((r for r in existing if r['buildingId'] == main['id'] and r['floorNo'] == n), None) or
            api.data('/floors', {'buildingId': main['id'], 'floorNo': n, 'name': f'{n}层', 'zones': ['走廊']}) for n in [1, 2]]
        specs = [('crack', {'width': .9}, {'width': .5}, 'mm', 'crack_width', [.1, .2, .3]),
            ('tilt', {'angleX': .05, 'angleY': 0}, {'angleX': 0, 'angleY': 0}, '°', 'tilt_xy', [.1, .2, .3]),
            ('vibration', {'accelRms': .05, 'accelPeak': .15}, {'accelRms': .01, 'accelPeak': .03}, 'm/s²', 'vibration', [.03, .08, .12])]
        points = {spec[0]: seed_point(api, {'spec': spec, 'building': main, 'floor': floors[0 if spec[0] != 'vibration' else 1]}) for spec in specs}
        events = api.data('/events')
        crack_event = next(row for row in events if row['pointId'] == points['crack']['point']['id'])
        result = {'main': main, 'quiet': quiet, 'floors': floors, 'points': points, 'crackEvent': crack_event,
            'events': events, 'hardware': 'simulation', 'api': '18010', 'gateway': '18011'}
        save(EVIDENCE / 'verification/business/fixture.json', result)
        save(EVIDENCE / 'verification/business/initial-insights.json', api.data('/mobile/insights'))
        print(json.dumps({'points': len(points), 'events': len(events), 'crackLevel': crack_event['level']}))
    finally:
        api.close()


def recover():
    api = Api()
    try:
        point = fixture()['points']['crack']['point']
        for minutes, width in [(-6, .52), (-4, .51), (-2, .50)]:
            api.data('/records', {'pointId': point['id'], 'values': {'width': width}, 'unit': 'mm',
                'source': 'manual', 'quality': 'valid', 'sampleTime': at(minutes), 'note': '模拟恢复复测'})
        event = next(row for row in api.data('/events') if row['id'] == fixture()['crackEvent']['id'])
        assert event['status'] == 'recovering'
        save(EVIDENCE / 'verification/business/recovering.json', event)
        print(json.dumps({'status': event['status'], 'rev': event['rev']}))
    finally:
        api.close()


if __name__ == '__main__':
    seed()
