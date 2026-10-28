"""Observe and exercise only the native zhutong App through SDK uitest."""

import argparse
import json
import re
import subprocess
import time
from pathlib import Path


REPO = Path(__file__).resolve().parents[2]
RUNTIME = REPO / 'backend/.runtime-native-online'
BUNDLE = 'org.zhutong.mobile'


def command(options, *arguments):
    result = subprocess.run([str(options.hdc), '-t', options.target, *arguments],
                            capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=30)
    output = result.stdout + result.stderr
    if result.returncode or '[Fail]' in output or 'Error:' in output:
        raise RuntimeError(output)
    return output


def flatten(value):
    if isinstance(value, list):
        return [row for item in value for row in flatten(item)]
    if not isinstance(value, dict):
        return []
    return [value.get('attributes', {})] + [row for child in value.get('children', []) for row in flatten(child)]


def owned_roots(value):
    attributes = value.get('attributes', {})
    if attributes.get('bundleName') == BUNDLE and attributes.get('focused') == 'true':
        return [value]
    return [root for child in value.get('children', []) for root in owned_roots(child)]


def observe(options, directory=RUNTIME):
    directory.mkdir(parents=True, exist_ok=True)
    command(options, 'shell', 'uitest', 'dumpLayout', '-b', BUNDLE,
            '-p', '/data/local/tmp/zhutong-online-layout.json')
    target = directory / 'layout.json'
    command(options, 'file', 'recv', '/data/local/tmp/zhutong-online-layout.json', str(target.resolve()))
    tree = json.loads(target.read_text(encoding='utf-8'))
    if not owned_roots(tree):
        # Some simulator IME transitions make the bundle-filtered dump empty.
        # Preserve only a verified focused root from this App in public evidence.
        command(options, 'shell', 'uitest', 'dumpLayout', '-p', '/data/local/tmp/zhutong-global-layout.json')
        fallback = RUNTIME / 'global-layout.json'
        command(options, 'file', 'recv', '/data/local/tmp/zhutong-global-layout.json', str(fallback.resolve()))
        roots = owned_roots(json.loads(fallback.read_text(encoding='utf-8')))
        if len(roots) == 1:
            tree = roots[0]
            target.write_text(json.dumps(tree, ensure_ascii=False), encoding='utf-8')
    return flatten(tree)


def target_center(rows, key):
    matches = [row for row in rows if row.get('id') == key and row.get('visible') == 'true']
    if len(matches) != 1:
        raise ValueError(f'Expected one visible native element {key}, found {len(matches)}')
    row = matches[0]
    if row.get('enabled') == 'false':
        raise ValueError(f'Native element is disabled: {key}')
    left, top, right, bottom = map(int, re.findall(r'-?\d+', row['bounds']))
    if right - left < 20 or bottom - top < 20:
        raise ValueError(f'Element is clipped; scroll and re-observe: {key}')
    return str((left + right) // 2), str((top + bottom) // 2)


def click_id(options, key, direction='down'):
    for attempt in range(5):
        rows = observe(options)
        try:
            center = target_center(rows, key)
            command(options, 'shell', 'uitest', 'uiInput', 'click', *center)
            return
        except ValueError:
            if attempt == 4:
                raise
            scrolls = [row for row in rows if row.get('type') == 'Scroll' and row.get('visible') == 'true']
            if not scrolls:
                raise ValueError('No observed native Scroll is available')
            boxes = [list(map(int, re.findall(r'-?\d+', row['bounds']))) for row in scrolls]
            left, top, right, bottom = max(boxes, key=lambda box: (box[2] - box[0]) * (box[3] - box[1]))
            start, end = (0.8, 0.25) if direction == 'down' else (0.25, 0.8)
            x = str((left + right) // 2)
            command(options, 'shell', 'uitest', 'uiInput', 'swipe', x, str(int(top + (bottom - top) * start)),
                    x, str(int(top + (bottom - top) * end)))


def replace_text(options, key, text):
    click_id(options, key, 'up')
    dismiss_input_consent(options, key)
    # SDK20 keyCode.KEYCODE_CTRL_LEFT + KEYCODE_A selects the existing text.
    command(options, 'shell', 'uitest', 'uiInput', 'keyEvent', '2072', '2017')
    command(options, 'shell', 'uitest', 'uiInput', 'text', text)
    rows = wait_for(options, lambda items: any(row.get('id') == key and row.get('text') == text for row in items))
    matching = [row for row in rows if row.get('id') == key]
    if len(matching) != 1 or matching[0].get('text') != text:
        raise ValueError('Native TextInput value did not match requested replacement')


def dismiss_input_consent(options, field):
    """Dismiss only the observed system IME consent; never accept its terms."""
    for _ in range(3):
        rows = observe(options)
        if any(row.get('id') == field for row in rows):
            return
        command(options, 'shell', 'uitest', 'dumpLayout', '-p', '/data/local/tmp/zhutong-input-consent.json')
        target = RUNTIME / 'input-consent.json'
        command(options, 'file', 'recv', '/data/local/tmp/zhutong-input-consent.json', str(target.resolve()))
        system_rows = flatten(json.loads(target.read_text(encoding='utf-8')))
        known = [row for row in system_rows if row.get('id') in
                 ['Paf.Permission.button_cancel', 'advanced_dialog_button_2'] and row.get('visible') == 'true']
        if len(known) != 1 or known[0].get('text') not in ['取消', '退出应用']:
            raise ValueError('Unexpected system overlay; no consent action was taken')
        command(options, 'shell', 'uitest', 'uiInput', 'click', *target_center(system_rows, known[0]['id']))
    raise ValueError('App field did not return after cancelling IME consent')


def wait_for(options, predicate, timeout=15):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        rows = observe(options)
        if predicate(rows):
            return rows
    raise TimeoutError('Expected native UI state was not observed')


def capture(options, directory):
    rows = observe(options, directory)
    command(options, 'shell', 'uitest', 'screenCap', '-p', '/data/local/tmp/zhutong-online-screen.png')
    command(options, 'file', 'recv', '/data/local/tmp/zhutong-online-screen.png', str(directory.resolve() / 'screen.png'))
    return rows


def run(options):
    if options.action == 'click':
        click_id(options, options.id)
    elif options.action == 'replace':
        replace_text(options, options.id, options.text)
    elif options.action == 'input':
        center = target_center(observe(options), options.id)
        command(options, 'shell', 'uitest', 'uiInput', 'inputText', *center, options.text)
    directory = options.output.resolve() if options.output else RUNTIME
    rows = capture(options, directory) if options.output else observe(options, directory)
    print(json.dumps([{key: row.get(key, '') for key in ['id', 'text', 'bounds', 'type']}
                      for row in rows if row.get('text') or row.get('id')], ensure_ascii=True, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['observe', 'click', 'input', 'replace'])
    parser.add_argument('--hdc', type=Path, default=Path('D:/DevEco/Studio/sdk/default/openharmony/toolchains/hdc.exe'))
    parser.add_argument('--target', default='127.0.0.1:5555')
    parser.add_argument('--id')
    parser.add_argument('--text', default='')
    parser.add_argument('--output', type=Path)
    run(parser.parse_args())
