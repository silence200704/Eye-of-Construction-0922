"""Seed only the independent native acceptance API through real business commands."""

from datetime import datetime, timezone

from http_api import Api, EVIDENCE, save


def seed(api):
    run = datetime.now(timezone.utc).strftime('%m%d%H%M%S')
    building = api.data('/buildings', {'code': f'N{run}', 'name': '原生验收校园楼', 'purpose': '教学',
                                      'footprint': {'x': 0.4, 'y': 0.4, 'w': 0.2, 'h': 0.2, 'rotate': 0}})
    floor = api.data('/floors', {'buildingId': building['id'], 'floorNo': 1, 'name': '一层', 'zones': ['走廊']})
    points = []
    for number in [1, 2]:
        points.append(api.data('/points', {'code': f'N{run}-P{number}', 'name': f'走廊{number}号人工检查点',
                                           'buildingId': building['id'], 'floorId': floor['id'], 'type': 'manual_check',
                                           'coord': {'x': 0.3 + number * 0.1, 'y': 0.4},
                                           'nfcLabel': f'TAG-NATIVE-{run}-{number}'}))
    plans = []
    for name, kind in [('原生巡检·闭环验收', 'patrol'), ('原生巡检·冲突重试', 'inspection')]:
        plans.append(api.data('/inspection/plans', {
            'name': name, 'kind': kind, 'buildingId': building['id'], 'floorIds': [floor['id']],
            'pointIds': [point['id'] for point in points], 'cycle': {'unit': 'day', 'interval': 1, 'atTime': '09:00'},
            'startDate': '2026-10-28', 'owner': '演示巡检人员', 'executorRole': 'inspector',
            'checklist': [{'key': 'wall', 'label': '墙面与结构外观', 'required': True, 'hint': '查看裂缝、起鼓与松动'},
                          {'key': 'passage', 'label': '通道与门窗', 'required': True, 'hint': '核对通道和门窗状态'}],
            'enabled': True}))
    api.data('/inspection/tasks/generate', {'date': '2026-10-28'})
    tasks = api.data('/inspection/tasks')
    selected = [next(task for task in tasks if task['planId'] == plan['id']) for plan in plans]
    return {'api': 'http://127.0.0.1:18003', 'gateway': 'http://127.0.0.1:18004', 'epoch': 1,
            'hardware': 'simulated', 'building': building, 'points': points, 'tasks': selected,
            'scope': 'Independent temporary database; delivery demo-main untouched'}


if __name__ == '__main__':
    client = Api()
    try:
        result = seed(client)
        save(EVIDENCE / 'verification/fixture.json', result)
        print(f'Seeded {len(result["tasks"])} tasks / {len(result["points"])} points in isolated API')
    finally:
        client.close()
