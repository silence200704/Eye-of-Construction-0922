"""通过业务接口显式导入项目语料；已有来源不覆盖。"""

import argparse
import json
from pathlib import Path

from client import Client

ROOT = Path(__file__).resolve().parents[2]
SYNONYMS = {
    "预警事件": ["报警事件", "警情"],
    "维修工单": ["维修单", "修理单"],
    "复查": ["复检", "回头检查"],
    "巡检": ["巡查", "查点"],
    "保养": ["养护", "例行维护"],
    "照片": ["图片", "传图"],
    "归档": ["退役", "停用档案"],
    "基准值": ["参考基线", "初始参照值"],
    "通知": ["提醒", "消息提醒"],
    "确认": ["签收"],
    "csv": ["表格"],
}


def seed(client: Client):
    sources = {doc["sourcePath"]: doc for doc in client.get("/documents")}
    faqs = {row["chunkId"] for row in client.get("/faqs")}
    rows = json.loads((ROOT / "resources/knowledge/corpus.json").read_text(encoding="utf-8"))
    for item in rows:
        doc = sources.get(item["sourcePath"])
        if doc is None:
            doc = client.post(
                "/documents",
                {key: item[key] for key in ("title", "sourcePath", "sourceKind", "content")},
            )
        chunk_id = doc["chunks"][0]["id"]
        if chunk_id not in faqs:
            client.post("/faqs", {"chunkId": chunk_id, "questions": item["faq"]})
    existing = {row["canonical"] for row in client.get("/synonyms")}
    for canonical, aliases in SYNONYMS.items():
        if canonical not in existing:
            client.post("/synonyms", {"canonical": canonical, "aliases": aliases})
    return client.post("/indexes/rebuild", {})


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:18000")
    args = parser.parse_args()
    client = Client(args.url)
    try:
        print(json.dumps(seed(client), ensure_ascii=False))
    finally:
        client.close()
