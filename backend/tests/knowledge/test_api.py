"""知识服务必须可追溯、可降级，且不写业务状态。"""

from monitoring.fixtures import Api, token_of


def post(api, path, body, key=None):
    return api.post("/knowledge" + path, body, key=key)


def document(api, **overrides):
    response = post(api, "/documents", {
        "title": "预警事件关闭流程", "sourcePath": "docs/knowledge/closing.md",
        "sourceKind": "project", "content": "# 事件关闭\n\n只有满足恢复条件并具有当前事件工单验收依据，或无需维修现场核查依据，安全管理人员才能关闭预警事件。",
        "roles": ["safety", "inspector"], **overrides,
    })
    assert response.status_code == 200, response.text
    return response.json()["data"]


def test_status_reports_explicit_missing_local_model(client, settings):
    api = Api(client, str(settings.database_url))
    response = client.get("/api/v1/datasets/demo-main/knowledge/status", headers=api.auth())
    assert response.status_code == 200
    assert response.json()["data"]["mode"] == "keyword"


def test_version_disable_and_faq_never_return_stale_citations(client, settings):
    api = Api(client, str(settings.database_url))
    doc = document(api)
    chunk = doc["chunks"][0]
    assert chunk["text"] in doc["content"]
    assert chunk["lineStart"] >= 1 and chunk["sha256"]
    assert post(api, "/faqs", {"chunkId": chunk["id"], "questions": ["怎么关闭预警事件"]}).status_code == 200
    found = api.ok(post(api, "/search", {"query": "怎么关闭预警事件"}))
    assert found["decision"] == "answer"
    assert "faq" in found["candidates"][0]["methods"]
    updated = api.ok(post(api, f"/documents/{doc['id']}/versions", {
        "expectedRev": doc["rev"], "content": "# 新版本\n\n预警事件关闭前应核对恢复复测和现场处置证据。",
    }))
    assert updated["version"] == 2
    current = api.ok(post(api, "/search", {"query": "关闭预警事件"}))
    assert all(row["version"] == 2 for row in current["candidates"])
    assert post(api, f"/documents/{doc['id']}/enabled", {"expectedRev": updated["rev"], "enabled": False}).status_code == 200
    assert api.ok(post(api, "/search", {"query": "怎么关闭预警事件"}))["candidates"] == []


def test_maintenance_role_and_document_audience(client, settings):
    api = Api(client, str(settings.database_url))
    document(api, roles=["safety"])
    api.token = token_of(client, "demo-repair")
    response = post(api, "/documents", {"title": "越权", "sourcePath": "x", "sourceKind": "project", "content": "越权内容"})
    assert response.status_code == 403
    assert api.ok(post(api, "/search", {"query": "预警事件关闭"}))["candidates"] == []


def test_missing_model_build_failure_is_visible_and_search_is_not_faked(client, settings):
    api = Api(client, str(settings.database_url))
    document(api)
    result = api.ok(post(api, "/indexes/rebuild", {}))
    assert result["built"] is False and result["error"]
    result = api.ok(post(api, "/search", {"query": "预警事件关闭"}))
    assert result["mode"] == "keyword" and result["degradedReason"]
    assert all("vector" not in row["methods"] for row in result["candidates"])


def test_ambiguous_and_outside_queries_do_not_fabricate_answers(client, settings):
    api = Api(client, str(settings.database_url))
    document(api)
    document(api, title="维修工单验收", content="# 工单验收\n\n维修工单必须由安全管理人员验收，维修人员不能自行验收。")
    assert api.ok(post(api, "/search", {"query": "怎么关闭"}))["decision"] == "clarify"
    assert api.ok(post(api, "/search", {"query": "今天食堂菜单是什么"}))["decision"] == "no_basis"
