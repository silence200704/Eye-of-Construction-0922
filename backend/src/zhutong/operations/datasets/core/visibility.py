"""Monitoring read projections share the current building scope."""

from sqlalchemy import select
from ....db.models.archive import Point
from .workspace import Workspace


def visible_point_ids(workspace: Workspace):
    query = select(Point.id).where(Point.dataset_id == workspace.dataset_id)
    if workspace.actor.building_ids is not None:
        query = query.where(Point.building_id.in_(workspace.actor.building_ids))
    return query


def scoped_archive(data: dict, workspace: Workspace) -> dict:
    allowed = workspace.actor.building_ids
    if allowed is None:
        return data
    data["buildings"] = [r for r in data["buildings"] if r["id"] in allowed]
    data["floors"] = [r for r in data["floors"] if r["buildingId"] in allowed]
    data["points"] = [r for r in data["points"] if r["buildingId"] in allowed]
    points = {r["id"] for r in data["points"]}
    data["devices"] = [r for r in data["devices"] if r["pointId"] in points]
    data["baselines"] = [r for r in data["baselines"] if r["pointId"] in points]
    data["rules"] = (
        [
            r
            for r in data["rules"]
            if (not r.get("buildingIds") or set(r["buildingIds"]) & set(allowed))
            and (not r.get("pointIds") or set(r["pointIds"]) & points)
        ]
        if allowed
        else []
    )
    data["audits"] = []  # Scoped field users do not receive the global administrator log.
    return data
