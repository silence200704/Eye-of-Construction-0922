"""数据库行 → API/前端领域对象（camelCase）。

读取新业务列与快照；legacy_payload 只用于溯源，不在这里回填成可写字段。
"""

from typing import Any


def _audit(row: Any) -> dict:
    return {
        "createdAt": row.created_at,
        "createdBy": row.created_by,
        "updatedAt": row.updated_at,
        "updatedBy": row.updated_by,
        "rev": row.revision,
    }


def building_out(row: Any) -> dict:
    return {
        "id": row.id,
        "code": row.code,
        "name": row.name,
        "purpose": row.purpose,
        "buildYear": row.build_year,
        "floorCount": row.floor_count,
        "area": row.area,
        "structureType": row.structure_type,
        "managerUnit": row.manager_unit,
        "userUnit": row.user_unit,
        "owner": row.owner,
        "ownerPhone": row.owner_phone,
        "backupPerson": row.backup_person,
        "source": row.source,
        "footprint": row.footprint or {},
        "dataSource": row.data_source,
        "remark": row.remark,
        "status": row.status,
        "archiveReason": row.archive_reason,
        "archivedAt": row.archived_at,
        "archivedBy": row.archived_by,
        **_audit(row),
    }


def floor_out(row: Any) -> dict:
    return {
        "id": row.id,
        "buildingId": row.building_id,
        "floorNo": row.floor_no,
        "name": row.name,
        "zones": row.zones or [],
        "planVersion": row.plan_version,
        "remark": row.remark,
        "status": row.status,
        "archiveReason": row.archive_reason,
        "archivedAt": row.archived_at,
        "archivedBy": row.archived_by,
        **_audit(row),
    }


def point_out(row: Any) -> dict:
    return {
        "id": row.id,
        "code": row.code,
        "name": row.name,
        "buildingId": row.building_id,
        "floorId": row.floor_id,
        "zoneId": row.zone_id,
        "type": row.type,
        "metric": row.metric,
        "coord": {"x": row.x, "y": row.y},
        "nfc": row.nfc,
        "planVersion": row.plan_version,
        "locationHistory": row.location_history or [],
        "owner": row.owner,
        "backupPerson": row.backup_person,
        "installDate": row.install_date,
        "dataSource": row.data_source,
        "remark": row.remark,
        "status": row.status,
        "archiveReason": row.archive_reason,
        "archivedAt": row.archived_at,
        "archivedBy": row.archived_by,
        **_audit(row),
    }


def device_out(row: Any) -> dict:
    return {
        **({"telemetry": row.telemetry} if getattr(row, "telemetry", None) is not None else {}),
        "id": row.id,
        "code": row.code,
        "name": row.name,
        "pointId": row.point_id,
        "model": row.model,
        "serial": row.serial,
        "rangeMin": row.range_min,
        "rangeMax": row.range_max,
        "rangeText": row.range_text,
        "unit": row.unit,
        "nodeId": row.node_id,
        "gateway": row.gateway,
        "mountPosition": row.mount_position,
        "direction": row.direction,
        "installDate": row.install_date,
        "calibratedAt": row.calibrated_at,
        "health": row.health,
        "remark": row.remark,
        "status": row.status,
        "archiveReason": row.archive_reason,
        "archivedAt": row.archived_at,
        "archivedBy": row.archived_by,
        **_audit(row),
    }


def baseline_out(row: Any) -> dict:
    return {
        "id": row.id,
        "pointId": row.point_id,
        "metric": row.metric,
        "values": row.values or {},
        "unit": row.unit,
        "version": row.version,
        "reason": row.reason,
        "effectiveFrom": row.effective_from,
        "createdBy": row.created_by,
        "createdAt": row.created_at,
        "current": row.current,
        "rev": row.revision,
    }


def rule_out(row: Any) -> dict:
    return {
        "id": row.id,
        "ruleId": row.rule_id,
        "code": row.code,
        "name": row.name,
        "metric": row.metric,
        "unit": row.unit,
        "version": row.version,
        "effectiveFrom": row.effective_from,
        "enabled": row.enabled,
        "buildingIds": row.building_ids or [],
        "pointIds": row.point_ids or [],
        "baselineSource": row.baseline_source,
        "fixedBaseline": row.fixed_baseline,
        "thresholds": row.thresholds,
        "rateThreshold": row.rate_threshold,
        "rateLevel": row.rate_level,
        "persistence": row.persistence or {},
        "recovery": row.recovery or {},
        "environment": row.environment,
        "source": row.source,
        "confirmedBy": row.confirmed_by,
        "note": row.note,
        **_audit(row),
    }


def record_out(row: Any) -> dict:
    return {
        "id": row.id,
        "recordNo": row.record_no,
        "pointId": row.point_id,
        "deviceId": row.device_id,
        "metric": row.metric,
        "values": row.values or {},
        "unit": row.unit,
        "sampleTime": row.sample_time,
        "sampleWindow": row.sample_window,
        "enteredAt": row.entered_at,
        "enteredBy": row.entered_by,
        "enteredByRole": row.entered_by_role,
        "source": row.source,
        "quality": row.quality,
        "qualityNote": row.quality_note,
        "note": row.note,
        "isBackfill": row.is_backfill,
        "baselineVersion": row.baseline_version,
        "baselineValues": row.baseline_values,
        "revision": row.record_revision,
        "recordRevision": row.record_revision,
        "revisions": row.revisions or [],
        "ruleId": row.rule_id,
        "ruleVersion": row.rule_version,
        "ruleSnapshot": row.rule_snapshot,
        "assessment": row.assessment,
        "createdAt": row.created_at,
        "rev": row.revision,
    }


def event_out(row: Any) -> dict:
    return {
        "id": row.id,
        "eventNo": row.event_no,
        "pointId": row.point_id,
        "ruleId": row.rule_id,
        "ruleCode": row.rule_code,
        "level": row.level,
        "peakLevel": row.peak_level,
        "status": row.status,
        "unit": row.unit,
        "openedAt": row.opened_at,
        "openedBy": row.opened_by,
        "lastTriggerAt": row.last_trigger_at,
        "lastTriggerValue": row.last_trigger_value,
        "evidences": row.evidences or [],
        "supersededEvidences": row.superseded_evidences or [],
        "upgrades": row.upgrades or [],
        "timeline": row.timeline or [],
        "acknowledgedAt": row.acknowledged_at,
        "acknowledgedBy": row.acknowledged_by,
        "closedAt": row.closed_at,
        "closedBy": row.closed_by,
        "closeBasis": row.close_basis,
        "note": row.note,
        **_audit(row),
    }


def notification_out(row: Any) -> dict:
    return {
        "id": row.id,
        "eventId": row.event_id,
        "eventNo": row.event_no,
        "level": row.level,
        "target": row.target,
        "channel": row.channel,
        "createdAt": row.created_at,
        "presentedAt": row.presented_at,
        "acknowledgedAt": row.acknowledged_at,
        "acknowledgedBy": row.acknowledged_by,
        "dueMinutes": row.due_minutes,
        "fallback": row.fallback,
        "escalatedAt": row.escalated_at,
        "escalatedTo": row.escalated_to,
        "escalationSource": row.escalation_source,
        "rev": row.revision,
    }


def audit_out(row: Any) -> dict:
    return {
        "id": row.id,
        "at": row.at,
        "actor": row.actor,
        "actorRole": row.actor_role,
        "action": row.action,
        "objectType": row.object_type,
        "objectId": row.object_id,
        "objectLabel": row.object_label,
        "summary": row.summary,
        "reason": row.reason,
    }
