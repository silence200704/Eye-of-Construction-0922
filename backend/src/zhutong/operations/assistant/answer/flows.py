"""服务端不执行的页面流程说明、导览/演示拒绝与阈值解析。"""

import re

from ....db.models.archive import Point
from ...datasets.trials import TrialThresholds
from . import facts


def _candidate_thresholds(question: str, context: dict) -> TrialThresholds | None:
    simulation = context.get("simulation")
    if simulation:
        return TrialThresholds(
            yellow=simulation.get("yellow"),
            orange=simulation.get("orange"),
            red=simulation.get("red"),
        )
    levels = {"黄": "yellow", "橙": "orange", "红": "red"}
    found: dict[str, float] = {}
    for match in re.finditer(r"(黄|橙|红)(?:色)?(?:阈值)?改为\s*([0-9]+(?:\.[0-9]+)?)", question):
        found[levels[match.group(1)]] = float(match.group(2))
    if not found:
        return None
    return TrialThresholds(
        yellow=found.get("yellow"), orange=found.get("orange"), red=found.get("red")
    )


def _frontend_flow_answer(intent: str, point: Point) -> dict:  # noqa: C901
    label = {
        "spatial_go": "3D 定位",
        "video_compare": "视频关键帧比较",
        "visual_evidence": "视觉证据同屏",
        "visual_region": "区域差异",
    }[intent]
    return {
        "intent": intent,
        "status": "answered",
        "conclusion": (
            f"已定位测点 {point.code} {point.name}；"
            f"{label}在页面内用已登记的会话影像与前端算法计算，"
            "影像与算法不在服务端执行，结果在回答卡片展示并写入媒体会话记录。"
        ),
        "facts": [{"label": "测点", "value": f"{point.code} {point.name}", "unit": ""}],
        "evidence": [],
        "gaps": [],
        "sources": {"facts": "server_db", "queriedAt": facts.queried_at()},
    }


def _demo_command_answer() -> dict:
    """写入请求一律不执行：只说明去哪里办，避免"说一句话就改了库"。"""
    return {
        "intent": "demo_command",
        "status": "unsupported",
        "conclusion": (
            "小瞳不在对话里写入或准备业务数据，本次提问没有修改任何记录。"
            "需要准备演示数据时请到系统设置执行全链命令；业务办理请到对应工作台由有权限的身份操作。"
        ),
        "facts": [],
        "evidence": [],
        "gaps": ["write_requires_workbench"],
        "sources": {"facts": "none", "queriedAt": facts.queried_at()},
        "dataNotes": ["建议不等于已执行；写入必须走真实业务命令并形成回执。"],
    }
