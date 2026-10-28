"""Collect only public inspection evidence after all native acceptance phases pass."""

import hashlib
import json
import re
import shutil
import sqlite3
import subprocess
import urllib.request
import zipfile
from datetime import datetime, timezone

from http_api import Api, EVIDENCE, ROOT, RUNTIME, fixture, save
from verify_http import delivery_snapshot, ledger


def restart_result():
    api = Api()
    try:
        ids = {task['id'] for task in fixture()['tasks']}
        after = [task for task in api.data('/inspection/tasks') if task['id'] in ids]
        before = json.loads((EVIDENCE / 'verification/restart-before.json').read_text(encoding='utf-8'))
        assert sorted(before, key=lambda row: row['id']) == sorted(after, key=lambda row: row['id'])
        save(EVIDENCE / 'verification/restart-after.json', {'unchanged': True, 'tasks': after})
        return after
    finally:
        api.close()


def receipts(task_ids):
    with sqlite3.connect(f'file:{(RUNTIME / "api/zhutong.sqlite").as_posix()}?mode=ro', uri=True) as connection:
        rows = connection.execute("select id,key,operation,epoch,actor_id,json_extract(response,'$.task.id') "
                                  "from operation_receipts where json_extract(response,'$.task.id') in (?,?)", task_ids).fetchall()
    return [dict(zip(['receiptId', 'key', 'operation', 'epoch', 'actorId', 'taskId'], row)) for row in rows]


def build_result():
    directory = EVIDENCE / 'builds'
    directory.mkdir(parents=True, exist_ok=True)
    for source, name in [('build.log', 'hvigor.log'), ('node-tests.log', 'node-tests.log'), ('coverage.log', 'coverage.log')]:
        shutil.copyfile(RUNTIME / source, directory / name)
    for name in ['red.log', 'form-red.log', 'reload-red.log', 'replay-red.log', 'replay-green.log']:
        target = directory / 'red' / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(RUNTIME / name, target)
    backend = directory / 'backend'
    backend.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(RUNTIME / 'backend-tests.log', backend / 'pytest.log')
    for name in ['ruff.log', 'format.log']:
        shutil.copyfile(RUNTIME / name, backend / name)
    backend_log = (RUNTIME / 'backend-tests.log').read_text(encoding='utf-8')
    completed = re.search(r'(?m)^(\d+) passed', backend_log)
    assert completed and not re.search(r'\d+ failed|\d+ errors?', backend_log), 'Backend regression not yet green'
    signing_dir = ROOT / 'backend/.runtime-native-online/signing'
    signing = json.loads((signing_dir / 'signing-result.json').read_text(encoding='utf-8'))
    hap = signing_dir / 'entry-default-debug-signed.hap'
    assert hashlib.sha256(hap.read_bytes()).hexdigest() == signing['signedSha256']
    assert signing['verified'] and signing['codeSigning']
    save(directory / 'signing.json', signing)
    with zipfile.ZipFile(hap) as archive:
        save(directory / 'pack-info.json', json.loads(archive.read('pack.info')))
    save(directory / 'commands.json', {'nativeBuildExit': 0, 'signingExit': 0, 'nativeTests': 41,
         'nativeTestsExit': 0, 'fieldCoreNodeCoverage': {'line': 95.14, 'branch': 87.31},
         'backendExistingContractTests': {'passed': 7, 'exitCode': 0},
         'backendFullRegression': {'passed': int(completed.group(1)), 'exitCode': 0,
                                  'coveragePercent': float(re.search(r'Total coverage: ([\d.]+)%', backend_log).group(1))},
         'hypiumRun': False, 'physicalDeviceRun': False, 'hardware': 'simulated'})
    return signing


def deployment_result():
    state = json.loads(subprocess.check_output(['docker', 'inspect', 'zhutong-api-1'], text=True))[0]
    migration = json.loads(subprocess.check_output(['docker', 'inspect', 'zhutong-migrate-1'], text=True))[0]
    assert state['State']['Health']['Status'] == 'healthy'
    assert migration['State']['ExitCode'] == 0 and migration['Image'] == state['Image']
    checks = {}
    for url in ['http://127.0.0.1:18000/api/v1/health/ready', 'http://127.0.0.1:8080/']:
        with urllib.request.urlopen(url, timeout=15) as response:
            assert response.status == 200
            checks[url] = response.status
    names = ['operations/field/task_checks.py', 'routers/datasets/field/api.py']
    code = ('import hashlib,json,sqlite3; from pathlib import Path; '
            f'names={names!r}; '
            "print(json.dumps({'sources':{name:hashlib.sha256((Path('/app/src/zhutong')/name).read_bytes()).hexdigest() for name in names},"
            "'migration':sqlite3.connect('file:/data/zhutong.sqlite?mode=ro',uri=True).execute('select version_num from alembic_version').fetchone()[0]}))")
    deployed = json.loads(subprocess.check_output(['docker', 'exec', 'zhutong-api-1', '/app/.venv/bin/python', '-c', code], text=True))
    for name, digest in deployed['sources'].items():
        assert digest == hashlib.sha256((ROOT / 'backend/src/zhutong' / name).read_bytes()).hexdigest()
    assert deployed['migration'] == '0013_assistant_session_epoch'
    return {'imageId': state['Image'], 'health': 'healthy', 'migrationExit': 0, 'probes': checks, **deployed}


def run():
    phases = ['setup', 'arrival', 'completion', 'conflict', 'retry', 'readonly', 'finish']
    for phase in phases:
        json.loads((EVIDENCE / 'verification/ui' / f'{phase}.json').read_text(encoding='utf-8'))
    tasks = restart_result()
    before = json.loads((EVIDENCE / 'verification/delivery-before.json').read_text(encoding='utf-8'))
    after = delivery_snapshot()
    assert before == after, 'Delivery business data changed'
    save(EVIDENCE / 'verification/delivery-after.json', {'unchanged': True, **after})
    signing = build_result()
    source = ROOT / 'mobile/openharmony/entry/src/main/ets'
    source_hashes = {path.relative_to(ROOT).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
                     for path in sorted(source.rglob('*.ets'))}
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    final = {'capturedAt': datetime.now(timezone.utc).isoformat(), 'sourceCommit': revision,
             'signedSha256': signing['signedSha256'], 'sourceSha256': source_hashes,
             'uiPhases': phases, 'ledgers': {task['id']: ledger(task['id']) for task in tasks},
             'receipts': receipts([task['id'] for task in tasks]),
             'backendSourceSha256': {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in [
                 'backend/src/zhutong/operations/field/task_checks.py',
                 'backend/src/zhutong/routers/datasets/field/api.py']},
             'deployment': deployment_result(),
             'finalState': 'Delivery 18080/8080, demo-safety; acceptance database kept separate',
             'scope': 'Online native inspection slice; stage 8 remains in progress'}
    save(EVIDENCE / 'verification/final.json', final)
    print(json.dumps({'sourceCommit': revision, 'signedSha256': signing['signedSha256'],
                      'nativeUiPhases': len(phases), 'taskStatuses': [task['status'] for task in tasks],
                      'deliveryUnchanged': True}, ensure_ascii=True))


if __name__ == '__main__':
    run()
