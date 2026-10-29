from ..fixtures import FieldApi


def returned_issue(api: FieldApi, category: str = 'description') -> dict:
    ids=api.seed_manual_point()
    body={'source':'report','pointId':ids['manual']['id'],'buildingId':ids['building']['id'],
          'anomalyType':'现场异常','description':'原始现场记录不可被补证覆盖','submissionId':'handling-origin','photos':[]}
    issue=api.ok_post('/issues',body,'handling-origin','demo-inspector')['issue']
    return api.review(issue,'need_evidence',category)['issue']


def assigned_order(api: FieldApi) -> dict:
    ids=api.seed_manual_point()
    issue=api.report_issue(ids['manual'])['issue']
    order=api.review(issue,'to_repair','equipment')['order']
    return api.advance(order,'assigned',assigneeId='demo-repair')['order']
