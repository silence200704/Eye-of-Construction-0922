"""验收脚本的真实 HTTP 客户端，不回显身份令牌。"""

from uuid import uuid4

import httpx


class Client:
    def __init__(self, url: str):
        self.http = httpx.Client(base_url=url, timeout=90, trust_env=False)
        identity = self.http.post("/api/v1/demo/identity", json={"identityId": "demo-safety"})
        identity.raise_for_status()
        self.http.headers["Authorization"] = "Bearer " + identity.json()["data"]["accessToken"]
        state = self.http.get("/api/v1/datasets/demo-main/state")
        state.raise_for_status()
        self.http.headers["X-Dataset-Epoch"] = str(state.json()["data"]["epoch"])
        self.prefix = "/api/v1/datasets/demo-main/knowledge"

    def get(self, path: str):
        response = self.http.get(self.prefix + path)
        response.raise_for_status()
        return response.json()["data"]

    def post(self, path: str, body: dict):
        response = self.http.post(
            self.prefix + path, json=body, headers={"Idempotency-Key": str(uuid4())}
        )
        response.raise_for_status()
        return response.json()["data"]

    def close(self):
        self.http.close()
