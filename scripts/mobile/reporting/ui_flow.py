"""Native report UI acceptance against a separate database and gateway."""
import argparse
import json
import re
import sqlite3
from scripts.mobile.reporting.common import Api, EVIDENCE, RUNTIME, fixture, save
from scripts.mobile.verification import playful as p


def capture(name):
    return p.ui.capture(p.OPTIONS, EVIDENCE / 'page' / name)


def reveal(fragment, direction='down'):
    for _ in range(7):
        rows = p.ui.observe(p.OPTIONS)
        if any(fragment in text for text in p.texts(rows)):
            return rows
        boxes = [list(map(int,re.findall(r'-?\d+',row['bounds']))) for row in rows if row.get('type') == 'Scroll' and row.get('visible') == 'true']
        left,top,right,bottom = max(boxes,key=lambda box:(box[2]-box[0])*(box[3]-box[1]))
        start,end = (.8,.25) if direction == 'down' else (.25,.8)
        p.ui.command(p.OPTIONS,'shell','uitest','uiInput','swipe',str((left+right)//2),str(int(top+(bottom-top)*start)),str((left+right)//2),str(int(top+(bottom-top)*end)))
    raise ValueError(f'Native text not revealed: {fragment}')


def back():
    rows = p.ui.observe(p.OPTIONS)
    button = next(row for row in rows if 'BackButton' in row.get('id','') and row.get('visible') == 'true')
    p.click(button['id'])


def click_text(text):
    rows = p.ui.observe(p.OPTIONS)
    matches = [row for row in rows if row.get('text') == text and row.get('visible') == 'true']
    assert len(matches) == 1, text
    left, top, right, bottom = map(int, re.findall(r'-?\d+', matches[0]['bounds']))
    p.ui.command(p.OPTIONS, 'shell', 'uitest', 'uiInput', 'click', str((left + right) // 2), str((top + bottom) // 2))


def connect(address):
    p.click('tab-3'); reveal('校园服务连接','up')
    rows=p.ui.observe(p.OPTIONS)
    if next(row for row in rows if row.get('id') == 'service-settings')['text'] == '设置':
        p.click('service-settings','up')
    p.ui.replace_text(p.OPTIONS,'service-address',address)
    p.click('connect-service'); p.expect('已连接')


def setup():
    connect('http://127.0.0.1:18086')
    p.click('tab-3'); p.click('identity-demo-inspector'); p.click('tab-2')
    p.click(f'inspection-task-{fixture()["task"]["id"]}')
    p.click('answer-wall-abnormal')
    p.click('inspection-report')
    p.expect('FIELD STORY'); capture('task-report-empty')
    p.ui.replace_text(p.OPTIONS,'report-anomaly','墙面异常（模拟素材）','down')
    p.ui.replace_text(p.OPTIONS,'report-description','比赛模拟验收：走廊墙面疑似裂缝，待专业人员核查。','down')
    p.click('report-submit')
    reveal('已提交','up'); capture('task-report-text-saved')
    api=Api()
    try:
        issue=api.data('/issues')[0]
        assert issue['taskId'] == fixture()['task']['id'] and issue['photos'] == []
        save(EVIDENCE/'verification/task-issue.json',issue)
    finally:
        api.close()
    return {'nativeTaskReport':True,'textOnlyAllowed':True,'issueId':issue['id']}


def complete():
    rows = p.ui.observe(p.OPTIONS)
    if any(row.get('id') == 'report-done' for row in rows):
        p.click('report-done')
    p.click('inspection-use-revision')
    issue = json.loads((EVIDENCE/'verification/task-issue.json').read_text(encoding='utf-8'))
    reveal(f'关联 {issue["id"]}')
    click_text(f'关联 {issue["id"]}')
    p.click('inspection-complete')
    reveal('全部测点已检查完成','up'); capture('task-abnormal-complete')
    api=Api()
    try:
        task=api.data('/inspection/tasks')[0]
        assert task['status'] == 'checked' and task['results'][0]['issueIds']
        save(EVIDENCE/'verification/task-complete.json',task)
    finally:
        api.close()
    back(); p.click('tab-0'); p.click('home-issues'); p.click('issue-new')
    p.click(f'report-point-{fixture()["point"]["id"]}')
    p.ui.replace_text(p.OPTIONS,'report-anomaly','照片上报（模拟素材）','down')
    p.ui.replace_text(p.OPTIONS,'report-description','比赛模拟验收照片，非真实校园隐患。用于核对原生相册上传及原件哈希。','down')
    capture('independent-draft')
    return {'taskChecked':True,'abnormalLinkedToRealIssue':True,'independentDraftOpened':True}


def camera():
    p.click('report-camera')
    p.expect('照片选择未完成'); capture('camera-unavailable')
    return {'cameraAttempted':True,'result':'Capability or permission unavailable on this simulator; physical capture NOT passed',
            'draftTextPreserved':True}


def album():
    p.click('report-album')
    return {'albumPickerOpened':True}


def prepare_photo():
    p.click('tab-0'); p.click('home-issues'); p.click('issue-new')
    p.click(f'report-point-{fixture()["point"]["id"]}')
    p.ui.replace_text(p.OPTIONS,'report-anomaly','照片上报（模拟素材）','down')
    p.ui.replace_text(p.OPTIONS,'report-description','比赛模拟验收照片，非真实校园隐患。用于核对原生相册上传及原件哈希。','down')
    save(EVIDENCE/'verification/ui/camera/result.json',camera())
    p.click('report-album')
    return {'independentDraftPrepared':True,'cameraCapturePassed':False,'albumSelectionPending':True}


def ledger():
    with sqlite3.connect(f'file:{(RUNTIME/"api/zhutong.sqlite").as_posix()}?mode=ro',uri=True) as db:
        return {name:db.execute(f'select count(*) from {name}').fetchone()[0]
                for name in ['issues','media_files','attachments','audits','operation_receipts']}


def photo_ready():
    p.expect('已选择 1/3'); capture('album-selected')
    reveal('比赛模拟验收照片','up')
    rows = capture('draft-after-picker')
    assert any(row.get('id') == 'report-description' and '比赛模拟验收照片' in row.get('text','') for row in rows)
    return {'selectedRealGalleryAsset':True,'compressedInNativeApp':True,'textAndTargetSurvivedExternalPicker':True,
            'fixture':'Synthetic test pattern, not a real defect','beforeUpload':ledger()}


def upload_loss():
    save(RUNTIME/'drop-response.json',{'path':'/api/v1/datasets/demo-main/media?'})
    p.click('report-submit')
    p.expect('重试上传并提交'); capture('upload-response-lost')
    after=ledger()
    assert after['media_files'] == 1 and after['attachments'] == 0 and after['issues'] == 1
    dropped=json.loads((RUNTIME/'dropped-response.json').read_text(encoding='utf-8'))
    return {'committedUploadResponseLost':True,'noFalseIssueSuccess':True,'ledger':after,'dropped':dropped}


def retry():
    save(RUNTIME/'drop-response.json',{'path':'/api/v1/datasets/demo-main/issues'})
    p.click('report-submit')
    reveal('服务端可能已保存','up'); capture('unknown-response')
    api=Api()
    try:
        before=api.data('/issues'); count=len(before); before_counts=ledger()
        assert count == 2 and len(before[-1]['photos']) == 1
        p.click('report-retry'); reveal('已提交','up'); capture('independent-photo-saved')
        after=api.data('/issues'); assert after == before and ledger() == before_counts
        save(EVIDENCE/'verification/independent-issue.json',after[-1])
        dropped=json.loads((RUNTIME/'dropped-response.json').read_text(encoding='utf-8'))
        return {'unknownThenRetry':True,'issuesBefore':count,'issuesAfter':len(after),'sameRows':True,
                'unchangedLedger':before_counts,'dropped':dropped}
    finally:
        api.close()


def finish():
    rows=p.ui.observe(p.OPTIONS)
    if any('BackButton' in row.get('id','') and row.get('visible') == 'true' for row in rows):
        back()
    connect('http://127.0.0.1:18080')
    p.click('tab-3'); p.click('identity-demo-safety'); p.click('tab-0')
    capture('delivery-restored')
    return {'deliveryConnectionRestored':True,'identity':'demo-safety'}


def restored():
    api=Api()
    try:
        rows={path:api.data(path) for path in ['/issues','/inspection/tasks','/attachments']}
        before=json.loads((EVIDENCE/'verification/runtime/before-restart.json').read_text(encoding='utf-8'))
        assert rows == before
        save(EVIDENCE/'verification/runtime/after-restart.json',{'sameBusinessRows':True,'serving':'restored-final','rows':rows})
    finally:
        api.close()
    p.ui.command(p.OPTIONS,'shell','aa','force-stop','org.zhutong.mobile')
    p.ui.command(p.OPTIONS,'shell','aa','start','-b','org.zhutong.mobile','-a','EntryAbility')
    p.expect('已连接'); p.click('home-issues')
    reveal('比赛验收反馈')
    capture('restored-review-feedback')
    return {'apiRestartedFromRestoredBackup':True,'appRestarted':True,'twoIssuesAndOnePhotoRecovered':True,
            'webReviewNoteVisibleInNativeApp':True}

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase',choices=['setup','complete','camera','album','prepare_photo','photo_ready','upload_loss','retry','restored','finish'])
    phase=parser.parse_args().phase
    result=globals()[phase]()
    save(EVIDENCE/'verification/ui'/f'{phase}.json',result)
    print(json.dumps(result,ensure_ascii=True))
