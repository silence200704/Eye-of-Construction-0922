"""阶段 7 后端测试夹具：复用阶段 4—6 的档案与命令上下文。"""

import hashlib

from field.fixtures import FieldApi
from monitoring.fixtures import token_of


def _key(prefix: str, value: str) -> str:
    digest = hashlib.sha256(value.encode("utf-8")).hexdigest()[:16]
    return f"{prefix}-{digest}"


class AssistantApi(FieldApi):
    def ask(
        self,
        question: str,
        context: dict | None = None,
        key: str = "ask-1",
        **options,
    ):
        response = self.raw_ask(question, context, key, options.get("account", "demo-safety"))
        assert response.status_code == 200, response.text
        return response.json()["data"]

    def raw_ask(
        self,
        question: str,
        context: dict | None = None,
        key: str = "ask-1",
        account: str = "demo-safety",
    ):
        body = {"question": question, "context": context or {}}
        return self.client.post(
            "/api/v1/datasets/demo-main/assistant/query",
            json=body,
            headers={
                "Authorization": f"Bearer {token_of(self.client, account)}",
                "Idempotency-Key": key,
                "X-Dataset-Epoch": str(self.epoch),
            },
        )

    def seed_red_event(self, widths: tuple[float, ...] = (0.55, 0.6, 0.82)) -> dict:
        """用真实记录命令种出一条未关闭事件（阶段 4 判定链路）。"""
        ids = self.seed_crack()
        for index, width in enumerate(widths):
            self.add_record(ids["point"]["id"], width, minutes=-60 + index * 10)
        ids["event"] = self.get("/events")[0]
        return ids

    def _knowledge_headers(self, key: str) -> dict:
        return {
            "Authorization": f"Bearer {token_of(self.client, 'demo-safety')}",
            "Idempotency-Key": key,
            "X-Dataset-Epoch": str(self.epoch),
        }

    def knowledge_doc(
        self,
        title: str,
        content: str,
        source_path: str = "docs/knowledge/assistant.md",
        roles: list[str] | None = None,
    ) -> dict:
        response = self.client.post(
            "/api/v1/datasets/demo-main/knowledge/documents",
            json={
                "title": title,
                "sourcePath": source_path,
                "sourceKind": "project",
                "roles": roles or ["safety", "property", "device", "inspector", "repair"],
                "content": content,
            },
            headers=self._knowledge_headers(_key("assistant-doc", title)),
        )
        assert response.status_code == 200, response.text
        return response.json()["data"]

    def knowledge_faq(self, chunk_id: str, questions: list[str]) -> None:
        response = self.client.post(
            "/api/v1/datasets/demo-main/knowledge/faqs",
            json={"chunkId": chunk_id, "questions": questions},
            headers=self._knowledge_headers(f"assistant-faq-{chunk_id}"),
        )
        assert response.status_code == 200, response.text

    def rebuild_knowledge(self) -> None:
        response = self.client.post(
            "/api/v1/datasets/demo-main/knowledge/indexes/rebuild",
            json={},
            headers=self._knowledge_headers("assistant-knowledge-rebuild"),
        )
        assert response.status_code == 200, response.text
