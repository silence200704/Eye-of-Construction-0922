"""Repeat native cartoon UI checks against the already-installed zhutong HAP."""

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import device_ui as ui

ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = ROOT / 'docs/implementation/evidence/stage8-playful'
OPTIONS = SimpleNamespace(hdc=Path('D:/DevEco/Studio/sdk/default/openharmony/toolchains/hdc.exe'),
                          target='127.0.0.1:5555')


def texts(rows):
    return [row.get('text', '') for row in rows if row.get('visible') == 'true']


def expect(fragment):
    return ui.wait_for(OPTIONS, lambda rows: any(fragment in text for text in texts(rows)))


def capture(name):
    return ui.capture(OPTIONS, EVIDENCE / 'page' / name)


def reveal(fragment):
    for _ in range(5):
        rows = ui.observe(OPTIONS)
        if any(fragment in text for text in texts(rows)):
            return rows
        boxes = [list(map(int, re.findall(r'-?\d+', row['bounds']))) for row in rows
                 if row.get('type') == 'Scroll' and row.get('visible') == 'true']
        left, top, right, bottom = max(boxes, key=lambda box: (box[2] - box[0]) * (box[3] - box[1]))
        x = str((left + right) // 2)
        ui.command(OPTIONS, 'shell', 'uitest', 'uiInput', 'swipe', x, str(int(top + (bottom - top) * 0.8)),
                   x, str(int(top + (bottom - top) * 0.25)))
    raise ValueError(f'Expected text was not revealed: {fragment}')


def click(key, direction='down'):
    ui.click_id(OPTIONS, key, direction)


def home():
    click('tab-0')
    rows = expect('当前可见测点')
    assert '8' in texts(rows) and '1' in texts(rows)
    capture('home')
    click('greet-mascot')
    expect('嗨！今天先看哪里？')
    capture('home-greeting')
    click('guide-dismiss')
    click('greet-mascot')
    click('guide-monitor')
    expect('把变化，看清楚')
    click('tab-0')
    capture('home')
    return {'points': 8, 'openEvents': 1, 'mascotGuide': 'opens, dismisses and navigates to live monitoring',
            'performance': 'No FPS claim'}


def monitor():
    click('tab-1')
    click('filter-tilt', 'up')
    rows = ui.observe(OPTIONS)
    history = next(row for row in rows if row.get('id') == 'toggle-event-history')
    if history.get('text') == '只看未关闭预警':
        click('toggle-event-history')
    rows = expect('当前可见 1 个测点')
    assert any('0.07' in text for text in texts(rows))
    capture('monitor-tilt')
    click('reading-note-pnt_b03_f2_tilt01')
    expect('质量：质量有效')
    capture('reading-expanded')
    click('reading-note-pnt_b03_f2_tilt01')
    click('point-pnt_b03_f2_tilt01')
    rows = expect('R20261018-009')
    assert any('当前服务未提供' in text for text in texts(rows))
    capture('point')
    rows = ui.observe(OPTIONS)
    back = [row for row in rows if 'BackButton' in row.get('id', '') and row.get('visible') == 'true']
    if not back:
        raise ValueError('Native navigation back button was not observed')
    click(back[0]['id'])
    expect('当前可见 1 个测点')
    click('toggle-event-history')
    rows = reveal('E20261018-002')
    assert 'E20261018-001' not in texts(rows)
    capture('monitor-history')
    click('filter-crack', 'up')
    expect('裂缝')
    capture('monitor-crack')
    click('filter-vibration', 'up')
    expect('振动')
    capture('monitor-vibration')
    click('toggle-event-history')
    click('filter-all', 'up')
    return {'tiltPoints': 1, 'tiltValue': '0.07 / 0°', 'record': 'R20261018-009',
            'backRetainsFilter': True, 'tiltHistoryHasNoUnrelatedCrackEvent': True,
            'inlineReadingNotesExpandAndCollapse': True}


def tasks():
    click('tab-2')
    click('task-inspections')
    expect('暂时没有待办')
    capture('tasks')
    click('task-orders')
    expect('工具已备好')
    capture('orders')
    click('task-inspections')
    return {'inspectionEmpty': True, 'ordersEmpty': True, 'demoTasksCreated': False}


def identities():
    click('tab-3')
    results = []
    expected = [('property', '物业值班人员'), ('device', '设备管理人员'), ('inspector', '巡检人员'),
                ('repair', '维修人员'), ('safety', '学校安全管理人员')]
    for role, label in expected:
        click(f'identity-demo-{role}')
        rows = expect(f'当前：{label}')
        capture(f'role-{role}')
        assert any(row.get('id') == f'identity-demo-{role}' and row.get('enabled') == 'true' for row in rows)
        results.append({'role': role, 'currentLabel': f'当前：{label}', 'verified': True})
    capture('profile')
    click('service-settings', 'up')
    expect('筑瞳服务地址')
    capture('connection-expanded')
    click('service-settings', 'up')
    rows = ui.observe(OPTIONS)
    assert not any(row.get('id') == 'service-address' and row.get('visible') == 'true' for row in rows)
    return {'roles': results, 'connectionAccordion': True}


def restart():
    ui.command(OPTIONS, 'shell', 'aa', 'force-stop', ui.BUNDLE)
    ui.command(OPTIONS, 'shell', 'aa', 'start', '-a', 'EntryAbility', '-b', ui.BUNDLE)
    expect('当前可见测点')


def appearance():
    click('tab-3')
    rows = reveal('轻动效')
    toggle = next(row for row in rows if row.get('id') == 'motion-toggle')
    if toggle.get('checked') == 'true':
        click('motion-toggle')
    expect('安静模式')
    capture('motion-off')
    click('tab-2')
    click('task-orders')
    expect('工具已备好')
    capture('quiet-tasks')
    click('tab-0')
    click('greet-mascot')
    expect('嗨！今天先看哪里？')
    capture('quiet-guide')
    click('guide-dismiss')
    restart()
    click('tab-3')
    rows = reveal('安静模式')
    toggle = next(row for row in rows if row.get('id') == 'motion-toggle')
    assert toggle.get('checked') == 'false', toggle
    capture('motion-off-restart')
    click('motion-toggle')
    expect('小瞳会轻轻动')
    return {'quietModeOperatesTasks': True, 'persistedAfterProcessRestart': True, 'finalMotion': True}


def error():
    click('tab-3')
    rows = ui.observe(OPTIONS)
    settings = [row for row in rows if row.get('id') == 'service-settings' and row.get('visible') == 'true']
    if not settings or settings[0].get('text') == '设置':
        click('service-settings', 'up')
    ui.replace_text(OPTIONS, 'service-address', 'http://127.0.0.1:18081')
    click('connect-service')
    expect('无法连接')
    capture('connection-error')
    click('tab-0')
    rows = expect('暂时无法连接筑瞳服务')
    assert texts(rows).count('—') >= 2, texts(rows)
    assert '8' not in texts(rows) and '1' not in texts(rows)
    capture('error-clears-data')
    restart()
    rows = expect('已连接')
    assert '8' in texts(rows) and '1' in texts(rows)
    capture('restart-connected')
    click('tab-3')
    expect('http://127.0.0.1:18080')
    capture('restored-connection')
    click('tab-0')
    capture('home')
    return {'badAddressShowsError': True, 'protectedMetricsCleared': True,
            'restartRestoresLastSuccessfulEndpoint': 'http://127.0.0.1:18080', 'finalConnected': True}


def run(phase):
    result = {'capturedAt': datetime.now(timezone.utc).isoformat(), 'bundle': ui.BUNDLE,
              'phase': phase, 'result': globals()[phase]()}
    output = EVIDENCE / 'verification' / f'{phase}.json'
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result, ensure_ascii=True))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=['home', 'monitor', 'tasks', 'identities', 'appearance', 'error'])
    run(parser.parse_args().phase)
