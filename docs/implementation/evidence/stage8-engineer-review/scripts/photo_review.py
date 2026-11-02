"""Seed one issue photo and one work order with before/after/acceptance photos."""
import hashlib
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import review_ui as r
from PIL import Image, ImageDraw

FIXTURE = json.loads((r.ROOT / 'docs/implementation/evidence/stage8-online-completion/verification/business/fixture.json')
                     .read_text(encoding='utf-8'))
POINT = FIXTURE['points']['crack']['point']['id']
BUILDING = FIXTURE['main']['id']
FLOOR = FIXTURE['floors'][0]['id']
ASSETS = r.EVIDENCE / 'assets'


def make(name, color, text):
    ASSETS.mkdir(parents=True, exist_ok=True)
    image = Image.new('RGB', (900, 640), (246, 250, 248))
    draw = ImageDraw.Draw(image)
    draw.rectangle([40, 40, 860, 600], outline=color, width=10)
    draw.rectangle([90, 90, 810, 430], fill=color)
    draw.text((120, 480), text, fill=(20, 40, 36))
    draw.text((120, 520), 'SIMULATED EVIDENCE - NOT A REAL CAMPUS DEFECT', fill=(20, 40, 36))
    target = ASSETS / name
    image.save(target, 'JPEG', quality=82)
    data = target.read_bytes()
    return {'path': str(target), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}


def upload(token, path, name, point_id=POINT):
    data = Path(path).read_bytes()
    query = urllib.parse.urlencode({'fileName': name, 'pointId': point_id, 'origin': 'demo_generated'})
    request = urllib.request.Request(f'{r.BASE}/datasets/demo-main/media?{query}', data=data, method='POST',
                                     headers={'Authorization': f'Bearer {token}', 'Content-Type': 'image/jpeg',
                                              'X-Dataset-Epoch': '1', 'Idempotency-Key': f'review-media-{name}'})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode('utf-8'))['data']


def seed():
    files = {
        'scene': make('issue-scene.jpg', (32, 132, 110), 'ISSUE SCENE PHOTO'),
        'before': make('repair-before.jpg', (176, 82, 52), 'REPAIR BEFORE PHOTO'),
        'after': make('repair-after.jpg', (40, 96, 176), 'REPAIR AFTER PHOTO'),
        'acceptance': make('acceptance.jpg', (120, 88, 168), 'ACCEPTANCE PHOTO'),
    }
    tokens = {role: r.session(role) for role in ['inspector', 'safety', 'repair']}
    try:
        scene = upload(tokens['inspector'], files['scene']['path'], 'issue-scene.jpg')
        issue_body = {'source': 'report', 'pointId': POINT, 'buildingId': BUILDING, 'floorId': FLOOR,
                      'anomalyType': '模拟裂缝观察', 'submissionId': 'review-photo-issue',
                      'description': '比赛模拟：裂缝观测点现场照片，用于核对原生已提交照片回读，非真实校园隐患。',
                      'photos': [{'mediaId': scene['id'], 'draftId': 'review-scene', 'kind': 'scene'}]}
        status, body = r.post('/datasets/demo-main/issues', issue_body, tokens['inspector'], 'review-issue-create')
        assert status == 200, body
        issue = body['data']['issue']
        status, body = r.post('/datasets/demo-main/work-orders',
                              {'pointId': POINT, 'title': '原生照片回读验收工单', 'note': '比赛模拟，用于核对维修前/后/验收标签。'},
                              tokens['safety'], 'review-order-create')
        assert status == 200, body
        order = body['data']['order']
        status, body = r.post(f'/datasets/demo-main/work-orders/{order["id"]}/actions',
                              {'expectedRev': order['rev'], 'to': 'assigned', 'assigneeId': 'demo-repair',
                               'note': '指定维修人验收模拟'}, tokens['safety'], 'review-order-assign')
        assert status == 200, body
        order = body['data']['order']
        status, body = r.post(f'/datasets/demo-main/work-orders/{order["id"]}/actions',
                              {'expectedRev': order['rev'], 'to': 'repairing', 'note': ''},
                              tokens['repair'], 'review-order-accept')
        assert status == 200, body
        order = body['data']['order']
        before = upload(tokens['repair'], files['before']['path'], 'repair-before.jpg')
        after = upload(tokens['repair'], files['after']['path'], 'repair-after.jpg')
        status, body = r.post(f'/datasets/demo-main/work-orders/{order["id"]}/actions',
                              {'expectedRev': order['rev'], 'to': 'submitted', 'measures': '模拟复紧固定件并完成外观检查。',
                               'photos': [{'mediaId': before['id'], 'draftId': 'review-before', 'kind': 'before'},
                                          {'mediaId': after['id'], 'draftId': 'review-after', 'kind': 'after'}]},
                              tokens['repair'], 'review-order-submit')
        assert status == 200, body
        order = body['data']['order']
        accepted = upload(tokens['safety'], files['acceptance']['path'], 'acceptance.jpg')
        status, body = r.post(f'/datasets/demo-main/work-orders/{order["id"]}/actions',
                              {'expectedRev': order['rev'], 'to': 'verified', 'note': '模拟验收通过。',
                               'photos': [{'mediaId': accepted['id'], 'draftId': 'review-acceptance', 'kind': 'acceptance'}]},
                              tokens['safety'], 'review-order-verify')
        assert status == 200, body
        order = body['data']['order']
        attachments = r.data('/attachments', tokens['safety'])
        chain = {'issue': issue, 'order': order, 'files': files,
                 'media': {'scene': scene, 'before': before, 'after': after, 'acceptance': accepted},
                 'attachments': attachments}
        r.save('verification/photos/chain.json', chain)
        print(json.dumps({'issueId': issue['id'], 'issueNo': issue['issueNo'], 'orderId': order['id'],
                          'orderNo': order['orderNo'], 'orderStatus': order['status'],
                          'orderPhotos': order['photos'], 'issuePhotos': issue['photos']}, ensure_ascii=False))
    finally:
        for token in tokens.values():
            r.logout(token)


if __name__ == '__main__':
    seed()
