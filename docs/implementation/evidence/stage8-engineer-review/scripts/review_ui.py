"""Independent stage 7A/8 acceptance helpers writing to stage8-engineer-review."""
import json
import re
import sqlite3
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[5]
sys.path.insert(0, str(ROOT / 'scripts/mobile'))
import device_ui as ui  # noqa: E402

OPTIONS = SimpleNamespace(hdc=Path('D:/DevEco/Studio/sdk/default/openharmony/toolchains/hdc.exe'),
                          target='127.0.0.1:5555')
EVIDENCE = ROOT / 'docs/implementation/evidence/stage8-engineer-review'
RUNTIME = ROOT / 'backend/.runtime-stage8-finish'
DB = RUNTIME / 'api/zhutong.sqlite'
BASE = 'http://127.0.0.1:18010/api/v1'


def stamp():
    return datetime.now(timezone.utc).isoformat()


def save(relative, value):
    target = EVIDENCE / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return target


def texts(rows):
    return [row.get('text', '') for row in rows if row.get('visible') == 'true']


def expect(fragment, timeout=20):
    return ui.wait_for(OPTIONS, lambda rows: any(fragment in text for text in texts(rows)), timeout=timeout)


def absent(fragment):
    rows = ui.observe(OPTIONS)
    return not any(fragment in text for text in texts(rows))


def capture(name):
    directory = EVIDENCE / 'page' / name
    rows = ui.capture(OPTIONS, directory)
    save(f'page/{name}/ids.json', [{'id': row.get('id', ''), 'text': row.get('text', ''),
                                    'bounds': row.get('bounds', ''), 'type': row.get('type', '')}
                                   for row in rows if row.get('id') or row.get('text')])
    return rows


def click(key, direction='down'):
    ui.click_id(OPTIONS, key, direction)


def click_text(value):
    rows = ui.observe(OPTIONS)
    matches = [row for row in rows if row.get('text') == value and row.get('visible') == 'true']
    clickable = [row for row in matches if row.get('clickable') == 'true']
    matches = clickable or matches
    if len(matches) < 1:
        raise ValueError(f'Expected a visible text {value}, found none')
    left, top, right, bottom = map(int, re.findall(r'-?\d+', matches[0]['bounds']))
    ui.command(OPTIONS, 'shell', 'uitest', 'uiInput', 'click', str((left + right) // 2), str((top + bottom) // 2))


def replace(key, text, direction='up'):
    ui.replace_text(OPTIONS, key, text, direction)


def reveal(fragment, direction='up', attempts=8):
    for _ in range(attempts):
        rows = ui.observe(OPTIONS)
        if any(fragment in text for text in texts(rows)):
            return rows
        boxes = [list(map(int, re.findall(r'-?\d+', row['bounds']))) for row in rows
                 if row.get('type') == 'Scroll' and row.get('visible') == 'true']
        left, top, right, bottom = max(boxes, key=lambda box: (box[2] - box[0]) * (box[3] - box[1]))
        start, end = (0.8, 0.25) if direction == 'down' else (0.25, 0.8)
        x = str((left + right) // 2)
        ui.command(OPTIONS, 'shell', 'uitest', 'uiInput', 'swipe', x, str(int(top + (bottom - top) * start)),
                   x, str(int(top + (bottom - top) * end)))
    raise ValueError(f'Native text not revealed: {fragment}')


def back():
    rows = ui.observe(OPTIONS)
    buttons = [row for row in rows if 'BackButton' in row.get('id', '') and row.get('visible') == 'true']
    if not buttons:
        raise ValueError('No native BackButton visible')
    click(buttons[0]['id'])


def connect(address):
    click('tab-3')
    reveal('校园服务连接', 'up')
    rows = ui.observe(OPTIONS)
    settings = next(row for row in rows if row.get('id') == 'service-settings')
    if settings.get('text') == '设置':
        click('service-settings', 'up')
    replace('service-address', address)
    click('connect-service')
    expect('已连接')
    return json.loads(json.dumps({'address': address, 'connected': True}))


def db_counts():
    with sqlite3.connect(f'file:{DB.as_posix()}?mode=ro', uri=True) as connection:
        names = ['events', 'issues', 'work_orders', 'media_files', 'attachments', 'audits', 'operation_receipts']
        return {name: connection.execute(f'select count(*) from {name}').fetchone()[0] for name in names}


def api(path, token=None):
    request = urllib.request.Request(f'{BASE}{path}', headers={'Authorization': f'Bearer {token}'} if token else {})
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.loads(response.read().decode('utf-8'))


def post(path, body, token, key, epoch='1'):
    request = urllib.request.Request(f'{BASE}{path}', data=json.dumps(body).encode('utf-8'), method='POST',
                                     headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json',
                                              'Idempotency-Key': key, 'X-Dataset-Epoch': epoch})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, json.loads(response.read().decode('utf-8'))
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read().decode('utf-8'))


def session(role):
    """Internal demo session token for read-only cross-checks (no password form)."""
    request = urllib.request.Request(f'{BASE}/demo/identity', data=json.dumps({'identityId': f'demo-{role}'}).encode('utf-8'),
                                     headers={'Content-Type': 'application/json'}, method='POST')
    with urllib.request.urlopen(request, timeout=20) as response:
        payload = json.loads(response.read().decode('utf-8'))
    return payload['data']['accessToken']


def data(path, token):
    return api(f'/datasets/demo-main{path}', token)['data']


def logout(token):
    request = urllib.request.Request(f'{BASE}/auth/logout', data=b'{}', method='POST',
                                     headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=20) as response:
        assert response.status == 200
