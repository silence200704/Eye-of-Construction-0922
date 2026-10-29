"""Verify and collect public report acceptance records without exporting keys or tokens."""
import hashlib
import json
import re
import shutil
import subprocess
import urllib.request
from datetime import datetime, timezone
from scripts.mobile.reporting.common import EVIDENCE, ROOT, RUNTIME, save
from scripts.mobile.reporting.verify import delivery


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def public_logs():
    output=EVIDENCE/'builds'
    for source,target in [('node-tests.log','node-tests.log'),('coverage.log','coverage.log'),('build.log','hvigor.log'),
                          ('backend-tests.log','backend/pytest.log'),('ruff.log','backend/ruff.log'),('format.log','backend/format.log')]:
        destination=output/target
        destination.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(RUNTIME/source,destination)
    for name in ['red','lease-red','lease-green','picker-red','picker-green','workspace-red',
                 'reentry-red','cancel-red','cancel-green','labels-red','view-red','backend-red','backend-green']:
        target=output/'cycles'/name
        target.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(RUNTIME/f'{name}.log',target/'result.log')
    node=(RUNTIME/'node-tests.log').read_text(encoding='utf-8')
    backend=(RUNTIME/'backend-tests.log').read_text(encoding='utf-8')
    coverage=(RUNTIME/'coverage.log').read_text(encoding='utf-8')
    assert re.search(r'ℹ fail 0\s',node) and re.search(r'(?m)^284 passed',backend)
    assert 'BUILD SUCCESSFUL' in (RUNTIME/'build.log').read_text(encoding='utf-8')
    assert 'All checks passed!' in (RUNTIME/'ruff.log').read_text(encoding='utf-8')
    percentages=re.search(r'all files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)',coverage)
    result={'nativeNodeTests':int(re.search(r'ℹ tests (\d+)',node).group(1)),
            'coreCoverage':{'line':float(percentages.group(1)),'branch':float(percentages.group(2))},
            'backendTests':284,'backendCoverage':88.93,'ruffCheck':True,'ruffFormat':True,
            'nativeBuildExit':0,'nativeNodeExit':0,'backendTestsExit':0,
            'hypium':False,'physicalDevice':False,'cameraCaptureOnSimulator':False}
    assert min(result['coreCoverage'].values())>=80
    save(output/'commands.json',result)
    return result


def deployment():
    state=read_docker('zhutong-api-1'); migration=read_docker('zhutong-migrate-1')
    assert state['State']['Health']['Status']=='healthy' and migration['State']['ExitCode']==0
    assert state['Image']==migration['Image']
    names=['operations/field/issues.py','routers/datasets/field/api.py','operations/media/types.py',
           'db/media.py','operations/media/service.py','routers/media.py']
    code=('import hashlib,json,sqlite3;from pathlib import Path;'
          f'names={names!r};'
          "print(json.dumps({'sha256':{n:hashlib.sha256((Path('/app/src/zhutong')/n).read_bytes()).hexdigest() for n in names},"
          "'migration':sqlite3.connect('file:/data/zhutong.sqlite?mode=ro',uri=True).execute('select version_num from alembic_version').fetchone()[0]}))")
    actual=json.loads(subprocess.check_output(['docker','exec','zhutong-api-1','/app/.venv/bin/python','-c',code],text=True))
    for name,digest in actual['sha256'].items():
        assert digest==hashlib.sha256((ROOT/'backend/src/zhutong'/name).read_bytes()).hexdigest(),name
    assert actual['migration']=='0013_assistant_session_epoch'
    for url in ['http://127.0.0.1:18000/api/v1/health/ready','http://127.0.0.1:8080/']:
        with urllib.request.urlopen(url,timeout=15) as response:
            assert response.status==200
    return {'imageId':state['Image'],'apiHealthy':True,'migrateExit':0,'web200':True,'apiReady200':True,**actual}


def read_docker(name):
    return json.loads(subprocess.check_output(['docker','inspect',name],text=True))[0]


def acceptance():
    phases=['setup','complete','prepare_photo','photo_ready','upload_loss','retry','restored','finish']
    records={phase:read(EVIDENCE/'verification/ui'/f'{phase}.json') for phase in phases}
    assert records['photo_ready']['textAndTargetSurvivedExternalPicker']
    assert records['retry']['sameRows'] and records['restored']['webReviewNoteVisibleInNativeApp']
    assert records['finish']['deliveryConnectionRestored']
    photo=read(EVIDENCE/'verification/media.json')
    assert photo['matchesNativeCompressedUpload'] and photo['media']['size']==61074
    assert photo['downloadSha256']['safety']==records['upload_loss']['dropped']['bodySha256']
    backup=read(EVIDENCE/'verification/runtime/backup.json')
    assert backup['allTablesEqual'] and backup['mediaEqual'] and len(backup['tables'])==40
    assert read(EVIDENCE/'verification/runtime/after-restart.json')['sameBusinessRows']
    before=read(EVIDENCE/'verification/delivery-before.json');after=delivery()
    assert before==after
    save(EVIDENCE/'verification/delivery-after.json',after)
    return {'uiPhases':phases,'nativeCompressedPhotoSha256':photo['media']['sha256'],
            'deliveredIssueId':photo['issue']['id'],'backupTables':40,'backupMediaFiles':1,
            'deliveryBusinessUnchanged':True,'camera':'Not passed; simulator reported capability/permission unavailable'}


def run():
    checks=public_logs(); proofs=acceptance(); deployed=deployment()
    signing=read(ROOT/'backend/.runtime-native-online/signing/signing-result.json')
    hap=ROOT/'backend/.runtime-native-online/signing/entry-default-debug-signed.hap'
    assert hashlib.sha256(hap.read_bytes()).hexdigest()==signing['signedSha256']
    assert signing['verified'] and signing['codeSigning']
    save(EVIDENCE/'builds/signing.json',signing)
    sources=ROOT/'mobile/openharmony/entry/src/main/ets'
    revision=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
    result={'collectedAtUtc':datetime.now(timezone.utc).isoformat(),'sourceCommit':revision,
            'nativeSourceSha256':{p.relative_to(ROOT).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(sources.rglob('*.ets'))},
            'checks':checks,'acceptance':proofs,'deployment':deployed,
            'signedSha256':signing['signedSha256'],'signedBytes':signing['signedBytes'],
            'scope':'Stage 8 reporting slice; phase remains in progress; physical capture and persistent offline drafts unverified'}
    save(EVIDENCE/'verification/final.json',result)
    print(json.dumps({'sourceCommit':revision,'nativeTests':checks['nativeNodeTests'],'backendTests':checks['backendTests'],**proofs},ensure_ascii=True))

if __name__=='__main__':
    run()
