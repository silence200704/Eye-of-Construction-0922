"""Collect asserted public handling evidence; never export session/signing secrets."""
import hashlib
import json
import re
import shutil
import subprocess
import urllib.request
from datetime import datetime, timezone
from scripts.mobile.handling.common import EVIDENCE, ROOT, RUNTIME, save
from scripts.mobile.reporting.verify import delivery


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def logs():
    mapping = {'backend-final.log': 'backend/pytest.log', 'ruff.log': 'backend/ruff.log',
        'format.log': 'backend/format.log', 'coverage-final.log': 'native/coverage-tests.log',
        'build-final.log': 'native/hvigor.log', 'web-final.log': 'web/vitest.log',
        'web-directory-green.log': 'web/session-regression.log', 'typecheck.log': 'web/typecheck.log',
        'web-build.log': 'web/build.log', 'tooling.log': 'web/tooling.log',
        'docker-build.log': 'deployment/build.log', 'docker-up.log': 'deployment/up.log'}
    for source, relative in mapping.items():
        target = EVIDENCE / 'builds' / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(RUNTIME / source, target)
    failures = ['backend-first-full', 'compat-red', 'web-directory-red', 'receipt-red', 'ui-open-order', 'ui-completion']
    for name in failures:
        target = EVIDENCE / 'builds/cycles' / name / 'result.log'
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(RUNTIME / f'{name}.log', target)
    text = lambda name: (RUNTIME / name).read_text(encoding='utf-8')
    assert '297 passed' in text('backend-final.log') and 'Total coverage: 88.94%' in text('backend-final.log')
    assert re.search(r'ℹ tests 77\s', text('coverage-final.log')) and re.search(r'ℹ fail 0\s', text('coverage-final.log'))
    assert '1171 passed' in text('web-final.log') and '125 passed' in text('web-final.log')
    assert 'BUILD SUCCESSFUL' in text('build-final.log') and 'All checks passed!' in text('ruff.log')
    assert '235 files already formatted' in text('format.log')
    assert 'ℹ pass 5' in text('tooling.log') and 'built in' in text('web-build.log')
    percentages = re.search(r'all files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)', text('coverage-final.log'))
    result = {'backendTests': 297, 'backendCoverage': 88.94, 'nativeNodeTests': 77,
        'nativeCoreLineCoverage': float(percentages[1]), 'nativeCoreBranchCoverage': float(percentages[2]),
        'webFiles': 125, 'webTests': 1171, 'toolingTests': 5, 'ruff': True, 'ruffFormat': True,
        'typecheckExit': 0, 'webBuildExit': 0, 'hvigorExit': 0, 'hypium': False, 'physicalDevice': False}
    assert min(result['nativeCoreLineCoverage'], result['nativeCoreBranchCoverage']) >= 80
    save(EVIDENCE / 'builds/commands.json', result)
    return result


def deployed():
    inspect = lambda name: json.loads(subprocess.check_output(['docker', 'inspect', name], text=True))[0]
    api, migrate = inspect('zhutong-api-1'), inspect('zhutong-migrate-1')
    assert api['State']['Health']['Status'] == 'healthy' and migrate['State']['ExitCode'] == 0
    assert api['Image'] == migrate['Image']
    names = ['operations/field/handling/access.py', 'operations/field/handling/supplements.py',
        'operations/field/orders.py', 'routers/datasets/field/handling_api.py', 'routers/datasets/field/api.py']
    code = ('import hashlib,json,sqlite3;from pathlib import Path;'
        f'names={names!r};'
        "print(json.dumps({'sha256':{n:hashlib.sha256((Path('/app/src/zhutong')/n).read_bytes()).hexdigest() for n in names},"
        "'migration':sqlite3.connect('file:/data/zhutong.sqlite?mode=ro',uri=True).execute('select version_num from alembic_version').fetchone()[0]}))")
    actual = json.loads(subprocess.check_output(['docker', 'exec', 'zhutong-api-1', '/app/.venv/bin/python', '-c', code], text=True))
    for name, digest in actual['sha256'].items():
        assert digest == hashlib.sha256((ROOT / 'backend/src/zhutong' / name).read_bytes()).hexdigest()
    assert actual['migration'] == '0013_assistant_session_epoch'
    for url in ['http://127.0.0.1:18000/api/v1/health/ready', 'http://127.0.0.1:8080/']:
        with urllib.request.urlopen(url, timeout=15) as response:
            assert response.status == 200
    before = read(EVIDENCE / 'verification/delivery/delivery-before.json')
    after = delivery(); assert before == after
    save(EVIDENCE / 'verification/delivery/delivery-after.json', after)
    result = {'apiHealthy': True, 'migrateExit': 0, 'web200': True, 'api200': True, 'businessUnchanged': True,
        'apiImage': api['Image'], 'webImage': inspect('zhutong-web-1')['Image'], **actual}
    save(EVIDENCE / 'builds/deployment/result.json', result)
    return result


def run():
    checks = logs(); deployment = deployed()
    signing = read(ROOT / 'backend/.runtime-native-online/signing/signing-result.json')
    hap = ROOT / 'backend/.runtime-native-online/signing/entry-default-debug-signed.hap'
    assert hashlib.sha256(hap.read_bytes()).hexdigest() == signing['signedSha256']
    assert signing['verified'] and signing['codeSigning']
    save(EVIDENCE / 'builds/native/signing.json', signing)
    for path in ['runtime/backup-final.json', 'runtime/after-restart-final.json', 'ui/restored.json', 'ui/finish.json',
                 'commands/completion-retry.json', 'commands/guards.json', 'business/final-smoke-result.json']:
        assert (EVIDENCE / 'verification' / path).is_file(), path
    assert read(EVIDENCE / 'verification/runtime/backup-final.json')['allTablesEqual']
    assert read(EVIDENCE / 'verification/ui/finish.json')['canonicalRestored']
    assert read(EVIDENCE / 'verification/business/final-smoke-result.json')['submittedByFinalHap']
    source = ROOT / 'mobile/openharmony/entry/src/main/ets'
    paths = list(sorted(source.rglob('*.ets'))) + [ROOT / name for name in [
        'src/stores/backend/session.ts', 'src/components/inspection/PhotoUploader.vue',
        'src/components/inspection/issue/WorkOrderPanel.vue']]
    result = {'collectedAtUtc': datetime.now(timezone.utc).isoformat(),
        'sourceCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
        'sourceSha256': {p.relative_to(ROOT).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths},
        'checks': checks, 'deployment': deployment, 'signedSha256': signing['signedSha256'], 'signedBytes': signing['signedBytes'],
        'mainFlow': 'native supplement → Web repair dispatch → native accept/submit → Web return → native rework → Web verify/recheck/close',
        'finalHapSmoke': 'one additional manual order accepted and submitted with measures only; safety verification via HTTP',
        'limitations': ['Stage 8 remains in progress', 'No physical device or Hypium', 'No persistent offline queue',
                        'App submitted-photo original zoom remains on Web', 'Web pre-existing visual working-tree changes preserved']}
    save(EVIDENCE / 'verification/final.json', result)
    print(json.dumps({'sourceCommit': result['sourceCommit'], 'signedSha256': signing['signedSha256'], **checks}, ensure_ascii=True))


if __name__ == '__main__':
    run()
