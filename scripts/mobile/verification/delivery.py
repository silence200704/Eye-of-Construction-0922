"""Collect public build metadata and read-only server evidence; never export tokens."""

import hashlib
import json
import shutil
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
RUNTIME = ROOT / 'backend/.runtime-native-online'
EVIDENCE = ROOT / 'docs/implementation/evidence/stage8-playful'
PHASES = ['home', 'monitor', 'tasks', 'identities', 'appearance', 'error']


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def request(path, token='', body=None):
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    data = json.dumps(body).encode() if body is not None else None
    query = urllib.request.Request(f'http://127.0.0.1:8080/api/v1{path}', data=data, headers=headers)
    with urllib.request.urlopen(query, timeout=15) as response:
        result = json.load(response)
    assert result['ok'], path
    return result


def server_snapshot():
    results = []
    for role in ['safety', 'property', 'device', 'inspector', 'repair']:
        session = request('/demo/identity', body={'identityId': f'demo-{role}'})['data']
        token = session['accessToken']
        try:
            principal = request('/auth/me', token)['data']
            archive = request('/datasets/demo-main/archive', token)['data']
            counts = {}
            events = []
            for key, path in [('records', '/records'), ('events', '/events?status=all'),
                              ('tasks', '/inspection/tasks'), ('orders', '/work-orders')]:
                rows = request(f'/datasets/demo-main{path}', token)
                assert rows['meta']['datasetEpoch'] == archive['epoch']
                counts[key] = len(rows['data'])
                if key == 'events':
                    events = rows['data']
            results.append({'identityId': principal['id'], 'role': principal['role'],
                            'epoch': archive['epoch'], 'activePoints': sum(p['status'] == 'active' for p in archive['points']),
                            'openEvents': sum(e['status'] != 'closed' for e in events), **counts})
        finally:
            request('/auth/logout', token, {})
    return {'capturedAt': datetime.now(timezone.utc).isoformat(), 'identities': results,
            'verificationSessionsLoggedOut': True, 'businessWrites': 0}


def build_evidence():
    directory = EVIDENCE / 'builds'
    directory.mkdir(parents=True, exist_ok=True)
    for source, target in [('build.log', 'hvigor.log'), ('node-tests.log', 'node-tests.log')]:
        shutil.copyfile(RUNTIME / source, directory / target)
    signing = json.loads((RUNTIME / 'signing/signing-result.json').read_text(encoding='utf-8'))
    assert signing['verified'] and signing['codeSigning']
    hap = RUNTIME / 'signing/entry-default-debug-signed.hap'
    assert hashlib.sha256(hap.read_bytes()).hexdigest() == signing['signedSha256']
    save(directory / 'signing.json', signing)
    raw_log = (RUNTIME / 'signing/signing.log').read_text(encoding='utf-8')
    safe_log = '\n'.join(line for line in raw_log.splitlines()
                         if any(marker in line for marker in ['Digest verify result:', 'verify: Verify success', 'verify-app success']))
    assert 'verify-app success' in safe_log
    (directory / 'signing.log').write_text(safe_log + '\n', encoding='utf-8')
    with zipfile.ZipFile(hap) as archive:
        pack = json.loads(archive.read('pack.info'))
    assert pack['summary']['app']['bundleName'] == 'org.zhutong.mobile'
    save(directory / 'pack-info.json', pack)
    return signing


def source_digest():
    ignored = {'build', '.hvigor', 'oh_modules', 'node_modules', '__pycache__'}
    extensions = {'.ets', '.ts', '.mjs', '.py', '.json', '.json5', '.svg'}
    result = {}
    for scope in ['mobile/openharmony', 'tests/mobile', 'scripts/mobile']:
        for path in sorted((ROOT / scope).rglob('*')):
            if path.is_file() and path.suffix in extensions and not ignored.intersection(path.parts):
                result[path.relative_to(ROOT).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
    return result


def run():
    signing = build_evidence()
    for phase in PHASES:
        result = json.loads((EVIDENCE / 'verification' / f'{phase}.json').read_text(encoding='utf-8'))
        assert result['capturedAt'] > signing['capturedAt'], f'Re-run final installed build: {phase}'
    save(EVIDENCE / 'verification/server.json', server_snapshot())
    checks = ['assembleApp --no-daemon', 'sign_online.py (verify-app)', 'HDC install/start',
              'node --test tests/mobile/*.test.mjs', 'structure.mjs', 'structure.py']
    save(EVIDENCE / 'builds/command-results.json', {'exitCodes': {check: 0 for check in checks},
         'nativeUiPhases': PHASES, 'hypiumRun': False, 'physicalDeviceRun': False})
    save(EVIDENCE / 'verification/delivery.json', {
        'capturedAt': datetime.now(timezone.utc).isoformat(), 'bundle': 'org.zhutong.mobile',
        'signedSha256': signing['signedSha256'], 'sourceSha256': source_digest(),
        'pageEvidence': sorted(p.parent.relative_to(EVIDENCE).as_posix() for p in EVIDENCE.rglob('screen.png')),
        'finalState': 'Connected home, demo-safety, motion enabled',
        'scope': 'Native online read-only foundation and cartoon UI; stage 8 remains in progress'})
    print(json.dumps({'signedSha256': signing['signedSha256'], 'uiPhases': PHASES,
                      'serverIdentities': 5, 'evidence': EVIDENCE.as_posix()}))


if __name__ == '__main__':
    run()
