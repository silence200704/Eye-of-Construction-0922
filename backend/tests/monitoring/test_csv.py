"""S4-05：CSV 逐行预检、有效行整批提交、过期预检与回滚。"""

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from zhutong.app import create_app
from zhutong.bootstrap import initialize
from zhutong.operations.datasets import importer

from .fixtures import Api, iso

HEADER = "测点编号,采样时间,裂缝宽度,单位,统计窗口,质量标记,备注"


def records_count(database_url: str) -> int:
    engine = create_engine(database_url)
    with engine.connect() as connection:
        value = connection.execute(text("select count(*) from records")).scalar_one()
    engine.dispose()
    return value


def csv_text(point_code: str) -> str:
    return "\n".join(
        [
            HEADER,
            f"{point_code},{iso(-70)},0.55,mm,,有效,现场量测",
            "NOPE-404," + f"{iso(-65)},0.62,mm,,有效,未知测点",
            f"{point_code},{iso(-60)},0.62,mm,,有效,现场量测",
        ]
    )


def test_preview_and_atomic_commit(client: TestClient, settings) -> None:
    api = Api(client, str(settings.database_url))
    ids = api.seed_crack()
    text_body = csv_text(ids["point"]["code"])
    preview = api.ok(api.post("/records/import-preview", {"csvText": text_body}))
    assert preview["warnCount"] == 2
    assert preview["errorCount"] == 1
    assert len([row for row in preview["rows"] if row["payload"] is not None]) == 2
    assert preview["rows"][1]["status"] == "error"
    assert "不存在" in "；".join(preview["rows"][1]["messages"])
    selected = [row["lineNo"] for row in preview["rows"] if row["payload"] is not None]
    result = api.ok(
        api.post(
            "/records/import",
            {
                "csvText": text_body,
                "token": preview["token"],
                "lineNos": selected,
                "fileName": "demo.csv",
            },
            key="csv-once",
        )
    )
    assert result["imported"] == 2
    assert result["skipped"] == 1
    records = api.get("/records")
    assert len(records) == 2
    assert {row["source"] for row in records} == {"csv"}
    assert records_count(str(settings.database_url)) == 2
    audits = api.get("/audits")
    assert any(row["action"] == "import" for row in audits)


def test_stale_preview_requires_repreview(client: TestClient, settings) -> None:
    api = Api(client, str(settings.database_url))
    ids = api.seed_crack()
    text_body = csv_text(ids["point"]["code"])
    preview = api.ok(api.post("/records/import-preview", {"csvText": text_body}))
    api.add_record(ids["point"]["id"], 0.58, minutes=-40)
    stale = api.post(
        "/records/import",
        {"csvText": text_body, "token": preview["token"], "fileName": "demo.csv"},
        key="csv-stale",
    )
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "PREVIEW_STALE"
    fresh = stale.json()["error"]["details"]["preview"]
    assert len([row for row in fresh["rows"] if row["payload"] is not None]) == 2
    assert len(api.get("/records")) == 1


def test_commit_failure_rolls_back_whole_batch(settings, monkeypatch) -> None:
    initialize(settings)
    with TestClient(create_app(settings), raise_server_exceptions=False) as client:
        api = Api(client, str(settings.database_url))
        ids = api.seed_crack()
        text_body = csv_text(ids["point"]["code"])
        preview = api.ok(api.post("/records/import-preview", {"csvText": text_body}))
        original = importer.create_record
        calls = {"count": 0}

        def flaky(*args, **kwargs):
            calls["count"] += 1
            if calls["count"] == 2:
                raise RuntimeError("模拟第二行写入失败")
            return original(*args, **kwargs)

        monkeypatch.setattr(importer, "create_record", flaky)
        response = api.post(
            "/records/import",
            {"csvText": text_body, "token": preview["token"], "fileName": "demo.csv"},
            key="csv-fail",
        )
        assert response.status_code == 500
        assert calls["count"] == 2
        assert records_count(str(settings.database_url)) == 0


def test_import_retry_replays_without_duplicates(client: TestClient, settings) -> None:
    api = Api(client, str(settings.database_url))
    ids = api.seed_crack()
    text_body = "\n".join([HEADER, f"{ids['point']['code']},{iso(-60)},0.62,mm,,有效,现场量测"])
    preview = api.ok(api.post("/records/import-preview", {"csvText": text_body}))
    body = {"csvText": text_body, "token": preview["token"], "fileName": "one.csv"}
    first = api.post("/records/import", body, key="csv-replay")
    second = api.post("/records/import", body, key="csv-replay")
    assert first.status_code == 200
    assert second.json()["replayed"] is True
    assert records_count(str(settings.database_url)) == 1


def test_csv_and_manual_share_assessment(client: TestClient, settings) -> None:
    api = Api(client, str(settings.database_url))
    ids = api.seed_crack()
    text_body = "\n".join([HEADER, f"{ids['point']['code']},{iso(-60)},0.62,mm,,有效,现场量测"])
    preview = api.ok(api.post("/records/import-preview", {"csvText": text_body}))
    imported = api.ok(
        api.post(
            "/records/import",
            {"csvText": text_body, "token": preview["token"], "fileName": "one.csv"},
            key="csv-compare",
        )
    )
    manual = api.add_record(ids["point"]["id"], 0.62, minutes=-70)
    csv_record = next(row for row in api.get("/records") if row["id"] == imported["records"][0])
    assert csv_record["assessment"]["state"] == manual["assessment"]["state"]
    assert csv_record["baselineVersion"] == manual["record"]["baselineVersion"]
    assert csv_record["ruleVersion"] == manual["record"]["ruleVersion"]
