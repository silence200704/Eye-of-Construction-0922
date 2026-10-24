# ruff: noqa: E501
"""阶段 7 交付容器只读冒烟：真实 HTTP、真实数据集，不写业务数据。"""

import json
from pathlib import Path

import httpx

BASE = "http://127.0.0.1:18000/api/v1/"
OUT = (
    Path(__file__).resolve().parents[2]
    / "docs/implementation/evidence/stage7-assistant/runtime/http-smoke.json"
)
QUESTIONS = [
    ("point", "B03-F2-CRACK01 现在怎么样", {}),
    ("event", "E20261018-001 为什么是橙色", {}),
    ("queue", "现在有哪些未处理预警", {}),
    ("overview", "全校现在概况如何", {}),
    ("knowledge", "是否需要注册账号和密码才能使用？", {}),
    ("write", "准备一次红色预警演示数据", {}),
]


def main() -> None:
    http = httpx.Client(base_url=BASE, timeout=60, trust_env=False)
    token = http.post("demo/identity", json={"identityId": "demo-safety"}).json()["data"][
        "accessToken"
    ]
    headers = {"Authorization": "Bearer " + token}
    epoch = http.get("datasets/demo-main/state", headers=headers).json()["data"]["epoch"]
    rows = []
    for index, (kind, question, context) in enumerate(QUESTIONS):
        response = http.post(
            "datasets/demo-main/assistant/query",
            json={"question": question, "context": context},
            headers={
                **headers,
                "Idempotency-Key": f"stage7-smoke-{index}",
                "X-Dataset-Epoch": str(epoch),
            },
        )
        assert response.status_code == 200, response.text
        data = response.json()["data"]
        answer = data["answer"]
        rows.append(
            {
                "kind": kind,
                "question": question,
                "sessionId": data["sessionId"],
                "answer": {
                    key: answer.get(key)
                    for key in (
                        "intent",
                        "status",
                        "conclusion",
                        "facts",
                        "objects",
                        "sources",
                        "citations",
                        "knowledge",
                        "links",
                        "gaps",
                    )
                },
            }
        )
    session = http.get(
        f"datasets/demo-main/assistant/sessions/{rows[0]['sessionId']}", headers=headers
    )
    assert session.status_code == 200, session.text
    detail = session.json()["data"]
    out = {
        "base": BASE,
        "epoch": epoch,
        "questions": rows,
        "sessionTurnCount": detail["turnCount"],
        "sessionQuestions": [turn["question"] for turn in detail["turns"]],
        "firstTurnObject": detail["turns"][0]["answer"]["objects"],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        json.dumps(
            {"questions": len(rows), "sessionTurnCount": detail["turnCount"], "output": str(OUT)},
            ensure_ascii=False,
        )
    )
    http.close()


if __name__ == "__main__":
    main()
