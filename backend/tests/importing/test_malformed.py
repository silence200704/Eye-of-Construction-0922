from conftest import demo_token
from fastapi.testclient import TestClient

from .test_import import package


def test_invalid_runtime_and_unknown_fields_are_reported(client: TestClient) -> None:
    headers = {"Authorization": f"Bearer {demo_token(client)}"}
    for runtime in [{"preferences": "not-an-array"}, {"unknownPersistedThing": [1]}, {"frames": [None]}]:
        response = client.post("/api/v1/datasets/demo-main/imports/preview", headers=headers, json={**package(), "runtime": runtime})
        assert response.status_code == 200
        assert response.json()["data"]["valid"] is False


def test_nonfinite_json_is_rejected_as_validation_error(client: TestClient) -> None:
    headers = {"Authorization": f"Bearer {demo_token(client)}", "Content-Type": "application/json"}
    with TestClient(client.app, raise_server_exceptions=False) as probe:
        response = probe.post("/api/v1/datasets/demo-main/imports", headers=headers, content=b'{"format":"zhutong-migration-v1","schemaVersion":7,"data":{"unknown":NaN}}')
    assert response.status_code == 422
