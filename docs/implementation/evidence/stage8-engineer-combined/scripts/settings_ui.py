"""Drive the system Settings app through HDC for real font-scale checks."""
import json
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import combined as c  # noqa: E402

ui = c.r.ui
LOCAL = c.EVIDENCE / 'page' / '_settings.json'


def flatten(value):
    if isinstance(value, list):
        return [row for item in value for row in flatten(item)]
    if not isinstance(value, dict):
        return []
    return [value.get('attributes', {})] + [row for child in value.get('children', []) for row in flatten(child)]


def rows():
    LOCAL.parent.mkdir(parents=True, exist_ok=True)
    ui.command(c.r.OPTIONS, 'shell', 'uitest', 'dumpLayout', '-p', '/data/local/tmp/settings-combined.json')
    ui.command(c.r.OPTIONS, 'file', 'recv', '/data/local/tmp/settings-combined.json', str(LOCAL.resolve()))
    return flatten(json.loads(LOCAL.read_text(encoding='utf-8')))


def center(row):
    left, top, right, bottom = map(int, re.findall(r'-?\d+', row['bounds']))
    return str((left + right) // 2), str((top + bottom) // 2)


def tap_text(text, exact=True):
    for _ in range(4):
        items = rows()
        matches = [row for row in items if row.get('visible') == 'true' and
                   ((row.get('text') == text) if exact else (text in (row.get('text') or '')))]
        clickable = [row for row in matches if row.get('clickable') == 'true']
        matches = clickable or matches
        if matches:
            x, y = center(matches[0])
            ui.command(c.r.OPTIONS, 'shell', 'uitest', 'uiInput', 'click', x, y)
            return matches[0]
        time.sleep(0.5)
    raise ValueError(f'Settings text not found: {text}')


def find(predicate):
    return [row for row in rows() if row.get('visible') == 'true' and predicate(row)]


def swipe(x1, y1, x2, y2, duration='600'):
    ui.command(c.r.OPTIONS, 'shell', 'uitest', 'uiInput', 'swipe', str(x1), str(y1), str(x2), str(y2), duration)


def open_font_page():
    ui.command(c.r.OPTIONS, 'shell', 'aa', 'start', '-b', 'com.huawei.hmos.settings',
               '-a', 'com.huawei.hmos.settings.MainAbility', '-m', 'phone_settings')
    time.sleep(2)
    tap_text('显示和亮度')
    time.sleep(1)
    tap_text('字体大小和界面缩放')
    time.sleep(1)


def font_slider():
    label = find(lambda row: row.get('text') == '字体大小')
    if not label:
        raise ValueError('Font size label missing')
    top = int(re.findall(r'-?\d+', label[0]['bounds'])[1])
    candidates = [row for row in rows() if re.fullmatch(r'\d\.\d{6}', row.get('text') or '')
                  and top <= int(re.findall(r'-?\d+', row['bounds'])[1]) <= top + 260]
    if not candidates:
        raise ValueError('Font slider value row missing')
    return min(candidates, key=lambda row: int(re.findall(r'-?\d+', row['bounds'])[1]))


def set_extreme():
    open_font_page()
    slider = font_slider()
    left, top, right, bottom = map(int, re.findall(r'-?\d+', slider['bounds']))
    swipe(left + 30, (top + bottom) // 2, right - 15, (top + bottom) // 2)
    time.sleep(1.5)
    state = [row.get('text') for row in rows() if row.get('text') in ('标准', '特大', '大', '小') or re.fullmatch(r'\d\.\d{6}', row.get('text') or '')]
    return {'slider': slider['bounds'], 'labels': state}


def restore_standard():
    slider = font_slider()
    left, top, right, bottom = map(int, re.findall(r'-?\d+', slider['bounds']))
    swipe(right - 15, (top + bottom) // 2, left + 25, (top + bottom) // 2)
    time.sleep(1.2)
    return [row.get('text') for row in rows() if row.get('text') in ('标准', '特大', '大', '小') or re.fullmatch(r'\d\.\d{6}', row.get('text') or '')]


def back_to_app():
    for _ in range(3):
        ui.command(c.r.OPTIONS, 'shell', 'uitest', 'uiInput', 'keyEvent', 'Back')
        time.sleep(0.7)
    ui.command(c.r.OPTIONS, 'shell', 'aa', 'start', '-a', 'EntryAbility', '-b', 'org.zhutong.mobile')
    time.sleep(2)
