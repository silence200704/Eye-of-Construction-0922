import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from zhutong.db.models import User
from ..fixtures import FieldApi,counts
from .fixtures import assigned_order


def test_order_list_does_not_leak_out_of_scope_rows(client,settings):
    api=FieldApi(client,str(settings.database_url)); assigned_order(api)
    engine=create_engine(str(settings.database_url))
    with Session(engine) as db,db.begin(): db.get(User,'demo-repair').building_ids_json='[]'
    engine.dispose()
    response=client.get('/api/v1/datasets/demo-main/work-orders',headers={'Authorization':f'Bearer {api.token_for("demo-repair")}'})
    assert response.status_code==200 and response.json()['data']==[]


@pytest.mark.parametrize('change',['scope','role'])
@pytest.mark.parametrize('action',['repairing','submitted'])
def test_order_receipt_replay_rechecks_current_permissions(client,settings,change,action):
    api=FieldApi(client,str(settings.database_url)); order=assigned_order(api)
    if action=='submitted': order=api.advance(order,'repairing',account='demo-repair')['order']
    body={'expectedRev':order['rev'],'to':action,'note':'现场办理','measures':'复紧更换并检查'}
    path=f'/work-orders/{order["id"]}/actions'
    api.ok_post(path,body,'handling-order-stable','demo-repair')
    before=counts(str(settings.database_url),'work_orders','issues','audits','operation_receipts')
    engine=create_engine(str(settings.database_url))
    with Session(engine) as db,db.begin():
        user=db.get(User,'demo-repair')
        if change=='scope': user.building_ids_json='[]'
        else: user.role='inspector'
    engine.dispose()
    response=api.fpost(path,body,'handling-order-stable','demo-repair')
    assert response.status_code==(403 if change=='scope' else 409)
    assert counts(str(settings.database_url),'work_orders','issues','audits','operation_receipts')==before


def test_order_authorized_replay_keeps_original_revision_and_counts(client,settings):
    api=FieldApi(client,str(settings.database_url)); order=assigned_order(api)
    body={'expectedRev':order['rev'],'to':'repairing','note':''}; path=f'/work-orders/{order["id"]}/actions'
    first=api.ok_post(path,body,'legit-stable','demo-repair')
    before=counts(str(settings.database_url),'work_orders','audits','operation_receipts')
    replay=api.fpost(path,body,'legit-stable','demo-repair')
    assert replay.status_code==200 and replay.json()['data']==first and replay.json()['replayed']
    assert counts(str(settings.database_url),'work_orders','audits','operation_receipts')==before
