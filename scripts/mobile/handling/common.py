"""Isolated native handling acceptance; never targets delivery writes."""
import json
import sqlite3
import urllib.parse
import urllib.request
from pathlib import Path
from scripts.mobile.inspection.http_api import Api as BaseApi, save

ROOT = Path(__file__).resolve().parents[3]
RUNTIME = ROOT / 'backend/.runtime-native-handling'
EVIDENCE = ROOT / 'docs/implementation/evidence/stage8-handling'


class Api(BaseApi):
    def __init__(self):
        super().__init__()
        self.base = 'http://127.0.0.1:18008/api/v1'

    def upload(self, point_id, role='inspector'):
        payload = (ROOT / 'backend/.runtime-native-report/fixture.jpg').read_bytes()
        query = urllib.parse.urlencode({'fileName': 'simulated-original.jpg', 'pointId': point_id})
        request = urllib.request.Request(f'{self.base}/datasets/demo-main/media?{query}', data=payload,
            headers={'Authorization': f'Bearer {self.token(role)}', 'Content-Type': 'image/jpeg',
                     'X-Dataset-Epoch': '1', 'Idempotency-Key': 'handling-synthetic-original'})
        with urllib.request.urlopen(request, timeout=20) as response:
            return json.load(response)['data']


def fixture():
    return json.loads((EVIDENCE / 'verification/business/fixture.json').read_text(encoding='utf-8'))


def ledger():
    with sqlite3.connect(f'file:{(RUNTIME / "api/zhutong.sqlite").as_posix()}?mode=ro', uri=True) as db:
        return {name: db.execute(f'select count(*) from {name}').fetchone()[0]
                for name in ['issues', 'work_orders', 'media_files', 'attachments', 'audits', 'operation_receipts']}


def seed():
    api = Api()
    try:
        archive = api.data('/archive')
        building = next((row for row in archive['buildings'] if row['code'] == 'APP-HANDLE'), None)
        building = building or api.data('/buildings', {'code': 'APP-HANDLE', 'name': '守护接续验收楼', 'purpose': '教学',
            'footprint': {'x': .3, 'y': .3, 'w': .2, 'h': .2, 'rotate': 0}})
        floor = next((row for row in archive['floors'] if row['buildingId'] == building['id']), None)
        floor = floor or api.data('/floors', {'buildingId': building['id'], 'floorNo': 1, 'name': '一层', 'zones': ['走廊']})
        point = next((row for row in archive['points'] if row['code'] == 'APP-HANDLE-P1'), None)
        point = point or api.data('/points', {'code': 'APP-HANDLE-P1', 'name': '模拟设备固定件检查点', 'buildingId': building['id'],
            'floorId': floor['id'], 'type': 'manual_check', 'coord': {'x': .4, 'y': .4}})
        media = api.upload(point['id'])
        issue = api.data('/issues', {'source': 'report', 'pointId': point['id'], 'buildingId': building['id'],
            'floorId': floor['id'], 'anomalyType': '模拟设备固定件松动', 'submissionId': 'handling-original',
            'description': '比赛模拟：检查到设备固定件疑似松动，此原始记录与照片需要完整保留。',
            'photos': [{'mediaId': media['id'], 'draftId': 'handling-original-photo', 'kind': 'scene'}]}, 'inspector')['issue']
        save(EVIDENCE / 'verification/business/fixture.json', {'building': building, 'point': point, 'issue': issue,
            'originalMedia': media, 'hardware': 'simulated', 'api': 'http://127.0.0.1:18008'})
        print(json.dumps({'issueId': issue['id'], 'issueNo': issue['issueNo'], 'originalPhotos': len(issue['photos'])}))
    finally:
        api.close()


if __name__ == '__main__':
    seed()
