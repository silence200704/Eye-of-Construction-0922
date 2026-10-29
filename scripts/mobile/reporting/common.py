"""Isolated report acceptance helpers; no delivery write targets."""
import json
from pathlib import Path
from scripts.mobile.inspection.http_api import Api as BaseApi, save

ROOT = Path(__file__).resolve().parents[3]
RUNTIME = ROOT / 'backend/.runtime-native-report'
EVIDENCE = ROOT / 'docs/implementation/evidence/stage8-reporting'

class Api(BaseApi):
    def __init__(self):
        super().__init__()
        self.base = 'http://127.0.0.1:18005/api/v1'


def fixture():
    return json.loads((EVIDENCE / 'verification/fixture.json').read_text(encoding='utf-8'))


def seed():
    api = Api()
    try:
        building = api.data('/buildings', {'code': 'APP-REPORT', 'name': '现场上报验收楼', 'purpose': '教学',
                                          'footprint': {'x': .3, 'y': .3, 'w': .2, 'h': .2, 'rotate': 0}})
        floor = api.data('/floors', {'buildingId': building['id'], 'floorNo': 1, 'name': '一层', 'zones': ['走廊']})
        point = api.data('/points', {'code': 'APP-REPORT-P1', 'name': '上报验收走廊测点', 'buildingId': building['id'],
                                    'floorId': floor['id'], 'type': 'manual_check', 'coord': {'x': .4, 'y': .4}, 'nfcLabel': 'TAG-REPORT-1'})
        api.data('/inspection/plans', {'name': '原生上报关联验收', 'kind': 'patrol', 'buildingId': building['id'],
            'floorIds': [floor['id']], 'pointIds': [point['id']], 'cycle': {'unit': 'day', 'interval': 1, 'atTime': '09:00'},
            'startDate': '2026-10-28', 'owner': '演示巡检', 'executorRole': 'inspector', 'enabled': True,
            'checklist': [{'key': 'wall', 'label': '墙面检查', 'required': True}]})
        api.data('/inspection/tasks/generate', {'date': '2026-10-28'})
        task = api.data('/inspection/tasks')[0]
        api.data(f'/inspection/tasks/{task["id"]}/check-in', {'expectedRev': task['rev'], 'pointId': point['id'],
            'method': 'nfc', 'labelRead': 'TAG-REPORT-1', 'fallbackReason': ''}, 'inspector')
        task = api.data('/inspection/tasks')[0]
        save(EVIDENCE / 'verification/fixture.json', {'api': 'http://127.0.0.1:18005', 'gateway': 'http://127.0.0.1:18006',
            'hardware': 'simulated', 'building': building, 'point': point, 'task': task})
        print('Seeded one isolated arrived task and manual point; delivery untouched')
    finally:
        api.close()

if __name__ == '__main__':
    seed()
