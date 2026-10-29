"""Recheck current permissions and reset version over TCP in the restored isolated service."""
import json
import sqlite3
import urllib.error
import urllib.request
from scripts.mobile.reporting.common import Api,EVIDENCE,RUNTIME,save


def counts():
    path=RUNTIME/'restored-final/zhutong.sqlite'
    with sqlite3.connect(path) as db:
        return {table:db.execute(f'select count(*) from {table}').fetchone()[0]
                for table in ['issues','media_files','attachments','audits','operation_receipts']}


def run():
    api=Api()
    current=json.loads((EVIDENCE/'verification/media.json').read_text(encoding='utf-8'))
    issue=current['issue']; attachment=current['attachments'][0]
    key=json.loads((EVIDENCE/'verification/ui/retry.json').read_text(encoding='utf-8'))['dropped']['key']
    body={'source':'report','pointId':issue['pointId'],'buildingId':issue['buildingId'],'floorId':issue['floorId'],
          'anomalyType':issue['anomalyType'],'description':issue['description'],'submissionId':issue['submissionKey'],
          'photos':[{'mediaId':attachment['mediaId'],'draftId':attachment['draftId'],'kind':'scene'}]}
    path=RUNTIME/'restored-final/zhutong.sqlite'
    with sqlite3.connect(path) as db:
        original_scope=db.execute("select building_ids_json from users where id='demo-inspector'").fetchone()[0]
        original_status=db.execute("select status from points where dataset_id='demo-main' and id=?",(issue['pointId'],)).fetchone()[0]
    before=counts(); results={}
    try:
        with sqlite3.connect(path) as db:
            db.execute("update users set building_ids_json='[]' where id='demo-inspector'")
        code,response=api.call('/issues',body,'inspector',key)
        assert code==403 and response['error']['code']=='SCOPE_FORBIDDEN'
        results['scopeRevokedReplay']=code
        with sqlite3.connect(path) as db:
            db.execute("update users set building_ids_json=? where id='demo-inspector'",(original_scope,))
            db.execute("update points set status='archived' where dataset_id='demo-main' and id=?",(issue['pointId'],))
        code,response=api.call('/issues',body,'inspector',key)
        assert code==404
        results['archivedPointReplay']=code
    finally:
        with sqlite3.connect(path) as db:
            db.execute("update users set building_ids_json=? where id='demo-inspector'",(original_scope,))
            db.execute("update points set status=? where dataset_id='demo-main' and id=?",(original_status,issue['pointId']))
    code,response=api.call('/issues',body,'inspector',key)
    assert code==200 and response['replayed'] is True
    results['authorizedOriginalReplay']=code
    request=urllib.request.Request(api.base+'/datasets/demo-main/media?fileName=epoch-guard.jpg',data=(RUNTIME/'fixture.jpg').read_bytes(),
        headers={'Authorization':f'Bearer {api.token("inspector")}','Content-Type':'image/jpeg','X-Dataset-Epoch':'2','Idempotency-Key':'native-stale-epoch-guard'})
    try:
        urllib.request.urlopen(request,timeout=15)
        raise AssertionError('Stale epoch media upload unexpectedly succeeded')
    except urllib.error.HTTPError as error:
        assert error.code==409
        results['staleEpochUpload']=error.code
    api.close()
    assert counts()==before
    save(EVIDENCE/'verification/runtime/http-guards.json',{'results':results,'noExtraBusinessOrAuditOrReceipt':True,'ledger':before,
        'target':'Only restored-final on 18005; configuration restored in finally'})
    print(json.dumps(results))

if __name__=='__main__':
    run()
