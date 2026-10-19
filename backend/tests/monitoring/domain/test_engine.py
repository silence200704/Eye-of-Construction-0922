"""阶段 4 · 旧新判定引擎共同样例（Python 侧）。"""

import copy
import json
from pathlib import Path

import pytest

from zhutong.domain.monitoring.engine import assess_record
from zhutong.domain.monitoring.validation import check_reading

FIXTURE = Path(__file__).resolve().parents[4] / "tests" / "shared" / "assessment-samples.json"
DATA = json.loads(FIXTURE.read_text(encoding="utf-8"))


def _rule(sample: dict) -> dict:
    rule = copy.deepcopy(DATA["rules"][sample["rule"]])
    rule.update(sample.get("rulePatch") or {})
    return rule


@pytest.mark.parametrize("sample", DATA["samples"], ids=[row["name"] for row in DATA["samples"]])
def test_engine_matches_shared_samples(sample: dict) -> None:
    result = assess_record(
        {
            "rule": _rule(sample),
            "point": sample["point"],
            "values": sample["values"],
            "baselineValues": sample["baselineValues"],
            "quality": sample["quality"],
            "device": sample["device"],
            "history": sample["history"],
            "at": sample["at"],
        }
    )
    expected = sample["expected"]
    assert result["state"] == expected["state"]
    if isinstance(expected.get("triggerValue"), (int, float)):
        assert result["triggerValue"] == pytest.approx(expected["triggerValue"], abs=1e-6)
    if isinstance(expected.get("baselineValue"), (int, float)):
        assert result["baselineValue"] == pytest.approx(expected["baselineValue"], abs=1e-6)
    if expected.get("reasonContains"):
        assert expected["reasonContains"] in result["reason"]
    if expected.get("basisContains"):
        assert expected["basisContains"] in result["basis"]
    if expected.get("insufficientContains"):
        assert expected["insufficientContains"] in result["insufficientReason"]


@pytest.mark.parametrize(
    "sample", DATA["validations"], ids=[row["name"] for row in DATA["validations"]]
)
def test_validation_matches_shared_samples(sample: dict) -> None:
    check = check_reading(
        {
            **sample["input"],
            "pointId": sample["point"]["id"],
            "metric": sample["point"]["metric"],
        },
        sample["existing"],
    )
    expected = sample["expected"]
    fields = [issue["field"] for issue in check["issues"]]
    for field in expected["issueFields"]:
        assert field in fields
    messages = "；".join(issue["message"] for issue in check["issues"])
    for fragment in expected["issueContains"]:
        assert fragment in messages
    if "outOfRange" in expected:
        assert check["outOfRange"] is expected["outOfRange"]
    if "backfill" in expected:
        assert check["backfill"] is expected["backfill"]


def test_rule_version_selection_respects_scope_without_fallback() -> None:
    from zhutong.domain.monitoring.rules import rule_for_point

    point = DATA["samples"][0]["point"]
    older = copy.deepcopy(DATA["rules"]["crack"])
    newer = {
        **copy.deepcopy(older),
        "id": "rule_crack_width@V1.1",
        "version": "V1.1",
        "buildingIds": ["bld_other"],
        "effectiveFrom": "2026-09-01T00:00:00.000Z",
    }
    at = "2026-09-20T09:00:00.000Z"
    assert rule_for_point([older, newer], point, at) is None
    assert rule_for_point([older, newer], point, "2026-08-15T09:00:00.000Z")["version"] == "V1.0"

    independent = {
        **copy.deepcopy(older),
        "id": "rule_other@V1.0",
        "ruleId": "rule_other",
        "code": "RULE-OTHER",
        "buildingIds": [],
        "pointIds": [],
        "effectiveFrom": "2026-09-02T00:00:00.000Z",
    }
    assert rule_for_point([older, newer, independent], point, at)["ruleId"] == "rule_other"

    excluded_point = {
        **copy.deepcopy(older),
        "id": "rule_crack_width@V1.2",
        "version": "V1.2",
        "pointIds": ["pnt_other"],
        "effectiveFrom": "2026-09-03T00:00:00.000Z",
    }
    assert rule_for_point([older, excluded_point], point, at) is None
