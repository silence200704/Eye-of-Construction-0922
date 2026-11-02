"""Build an isolated 500-point / 5000-record performance fixture by cloning the acceptance DB."""
import json
import random
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[5]
SOURCE = ROOT / 'backend/.runtime-stage8-finish/api/zhutong.sqlite'
TARGET_DIR = ROOT / 'backend/.runtime-stage8-stress/api'
TARGET = TARGET_DIR / 'zhutong.sqlite'
EVIDENCE = ROOT / 'docs/implementation/evidence/stage8-engineer-review/verification/stress'


def copy_database():
    TARGET_DIR.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(SOURCE) as source, sqlite3.connect(TARGET) as target:
        source.backup(target)


def seed():
    random.seed(20261029)
    now = datetime.now(timezone.utc)
    with sqlite3.connect(TARGET) as db:
        db.row_factory = sqlite3.Row
        base_point = db.execute("select * from points where code='FINISH-crack'").fetchone()
        base_device = db.execute("select * from devices where point_id=?", (base_point['id'],)).fetchone()
        base_record = db.execute("select * from records where point_id=?", (base_point['id'],)).fetchone()
        floors = [row[0] for row in db.execute("select id from floors where building_id=?", (base_point['building_id'],))]
        types = ['crack', 'tilt', 'vibration']
        units = {'crack': 'mm', 'tilt': '°', 'vibration': 'm/s²'}
        metrics = {'crack': 'crack_width', 'tilt': 'tilt_xy', 'vibration': 'vibration'}
        values = {'crack': {'width': 0.11}, 'tilt': {'angleX': 0.02, 'angleY': 0.01}, 'vibration': {'accelRms': 0.01, 'accelPeak': 0.02}}
        point_rows, device_rows, record_rows = [], [], []
        for index in range(497):
            kind = types[index % 3]
            point_id = f'pnt_stress_{index:04d}'
            floor_id = floors[index % len(floors)]
            point = dict(base_point)
            point.update({'id': point_id, 'code': f'STRESS-{index:04d}', 'name': f'压力测点 {index + 1:03d}',
                          'floor_id': floor_id, 'type': kind, 'metric': metrics[kind], 'x': 0.05 + (index % 20) * 0.045,
                          'y': 0.05 + ((index // 20) % 20) * 0.045, 'created_at': now.isoformat(),
                          'updated_at': now.isoformat(), 'revision': 1, 'nfc_code': None})
            point_rows.append(point)
            device = dict(base_device)
            device.update({'id': f'dev_stress_{index:04d}', 'code': f'STRESS-DEV-{index:04d}',
                           'name': f'模拟{kind}传感器 {index + 1:03d}', 'point_id': point_id, 'unit': units[kind],
                           'created_at': now.isoformat(), 'updated_at': now.isoformat(), 'revision': 1,
                           'telemetry': json.dumps({'source': 'simulation', 'connection': 'online', 'batteryPercent': 85.0,
                                                    'lastReportAt': now.isoformat(), 'updatedAt': now.isoformat()})})
            device_rows.append(device)
            for slot in range(10):
                record = dict(base_record)
                record.update({'id': f'rec_stress_{index:04d}_{slot:02d}', 'record_no': f'RS{index:04d}{slot:02d}',
                               'point_id': point_id, 'device_id': device['id'], 'metric': metrics[kind],
                               'values': json.dumps(values[kind]), 'unit': units[kind],
                               'sample_time': (now - timedelta(minutes=slot * 17 + 3)).isoformat(),
                               'sample_window': '', 'entered_at': now.isoformat(), 'created_at': now.isoformat(),
                               'rule_id': None, 'rule_version': None, 'rule_snapshot': None, 'assessment': None,
                               'revision': 1, 'record_revision': 0})
                record_rows.append(record)
        for slot in range(30):
            record = dict(base_record)
            record.update({'id': f'rec_stress_extra_{slot:02d}', 'record_no': f'RSX{slot:03d}',
                           'point_id': base_point['id'], 'device_id': base_device['id'],
                           'sample_time': (now - timedelta(minutes=slot * 9 + 1)).isoformat(),
                           'values': json.dumps({'width': 0.52 + slot * 0.001}), 'entered_at': now.isoformat(),
                           'created_at': now.isoformat(), 'rule_id': None, 'rule_version': None,
                           'rule_snapshot': None, 'assessment': None, 'revision': 1, 'record_revision': 0})
            record_rows.append(record)
        point_keys = ','.join(f':{key}' for key in point_rows[0])
        device_keys = ','.join(f':{key}' for key in device_rows[0])
        record_keys = ','.join(f':{key}' for key in record_rows[0])
        db.executemany(f'insert into points ({",".join(point_rows[0])}) values ({point_keys})', point_rows)
        db.executemany(f'insert into devices ({",".join(device_rows[0])}) values ({device_keys})', device_rows)
        columns = ','.join(f'"{key}"' for key in record_rows[0])
        db.executemany(f'insert into records ({columns}) values ({record_keys})', record_rows)
        db.commit()
        counts = {'points': db.execute('select count(*) from points').fetchone()[0],
                  'devices': db.execute('select count(*) from devices').fetchone()[0],
                  'records': db.execute('select count(*) from records').fetchone()[0]}
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    (EVIDENCE / 'seed.json').write_text(json.dumps({'counts': counts, 'samplePoint': 'pnt_stress_0000',
                                                    'sampleDevice': 'dev_stress_0000', 'seededAt': now.isoformat()},
                                                   ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(counts))


if __name__ == '__main__':
    copy_database()
    seed()
