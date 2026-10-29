"""Cross-read stored report photos and preserve delivery business snapshots."""
import argparse
import hashlib
import json
import sqlite3
import urllib.request
from scripts.mobile.reporting.common import Api, EVIDENCE, RUNTIME, save


def delivery():
    api=Api(); api.base='http://127.0.0.1:8080/api/v1'
    try:
        rows={path:api.data(path) for path in ['/archive','/records','/events?status=all','/inspection/tasks','/work-orders','/issues','/attachments']}
        return {'businessSha256':hashlib.sha256(json.dumps(rows,sort_keys=True).encode()).hexdigest(),
                'counts':{'buildings':len(rows['/archive']['buildings']),'points':len(rows['/archive']['points']),
                          **{key:len(value) for key,value in rows.items() if isinstance(value,list)}}}
    finally:
        api.close()


def media():
    api=Api()
    try:
        issue=next(row for row in api.data('/issues') if row['source'] == 'report')
        attachments=[row for row in api.data('/attachments') if row['issueId'] == issue['id']]
        assert len(attachments) == len(issue['photos']) == 1
        media_id=attachments[0]['mediaId']
        metadata=api.data(f'/media/{media_id}',role='inspector')
        hashes={}
        for role in ['inspector','safety']:
            request=urllib.request.Request(f'{api.base}/datasets/demo-main/media/{media_id}/content',
                                           headers={'Authorization':f'Bearer {api.token(role)}'})
            with urllib.request.urlopen(request,timeout=15) as response:
                data=response.read()
                assert len(data) == metadata['size']
                hashes[role]=hashlib.sha256(data).hexdigest()
        dropped=json.loads((EVIDENCE/'verification/ui/upload_loss.json').read_text(encoding='utf-8'))['dropped']
        assert hashes['inspector'] == hashes['safety'] == metadata['sha256'] == dropped['bodySha256']
        assert media_id == attachments[0]['mediaId'] and attachments[0]['id'] in issue['photos']
        result={'issue':issue,'attachments':attachments,'media':metadata,'downloadSha256':hashes,
                'matchesNativeCompressedUpload':True,'originalUncompressedCapturePreserved':False,
                'crossClient':'Inspector and Web safety identity through same protected content endpoint; browser click recorded separately'}
        save(EVIDENCE/'verification/media.json',result)
        return {'issueNo':issue['issueNo'],'mediaId':media_id,'bytes':metadata['size'],'sha256':metadata['sha256'],'crossIdentityEqual':True}
    finally:
        api.close()


def table_hashes(directory):
    with sqlite3.connect(f'file:{(directory/"zhutong.sqlite").as_posix()}?mode=ro',uri=True) as db:
        names=[row[0] for row in db.execute("select name from sqlite_master where type='table' and name not like 'sqlite_%'")]
        result={}
        for name in names:
            rows=db.execute(f'select * from "{name}"').fetchall()
            digest=hashlib.sha256(json.dumps(sorted(rows,key=repr),default=str).encode()).hexdigest()
            result[name]={'count':len(rows),'sha256':digest}
        return result

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase',choices=['before','after','media'])
    phase=parser.parse_args().phase
    if phase == 'media':
        result=media()
    else:
        result=delivery()
        if phase == 'after':
            before=json.loads((EVIDENCE/'verification/delivery-before.json').read_text(encoding='utf-8'))
            assert result == before, 'Delivery business data changed'
        save(EVIDENCE/'verification'/f'delivery-{phase}.json',result)
    print(json.dumps(result,ensure_ascii=True))
