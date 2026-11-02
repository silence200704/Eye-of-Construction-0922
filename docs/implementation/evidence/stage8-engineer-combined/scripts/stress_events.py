"""Labeled pressure events for ranked insight pagination; stress DB only."""
import json
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[5]
DB = ROOT / 'backend/.runtime-stage8-stress/api/zhutong.sqlite'
EVIDENCE = ROOT / 'docs/implementation/evidence/stage8-engineer-combined/verification/stress'
COUNTS = {0: 5, 1: 4, 2: 3, 3: 2, 4: 1}


def main():
    now = datetime.now(timezone.utc)
    with sqlite3.connect(DB) as db:
        db.row_factory = sqlite3.Row
        template = dict(db.execute("select * from events limit 1").fetchone())
        db.execute("delete from events where event_no like 'EST20261030-%'")
        rows = []
        sequence = 0
        for index in range(45):
            point = f'pnt_stress_{index:04d}'
            count = COUNTS.get(index, 1)
            for slot in range(count):
                sequence += 1
                status = 'closed' if slot < count - 1 else 'pending'
                event = dict(template)
                event.update({
                    'id': f'evt_stress_est_{index:03d}_{slot:02d}',
                    'event_no': f'EST20261030-{sequence:03d}',
                    'point_id': point,
                    'level': 'yellow', 'peak_level': 'yellow',
                    'status': status,
                    'opened_at': (now - timedelta(minutes=index * 3 + slot)).isoformat(),
                    'last_trigger_at': (now - timedelta(minutes=index * 3 + slot)).isoformat(),
                    'last_trigger_value': 0.04,
                    'timeline': '[]', 'evidences': '[]', 'superseded_evidences': '[]', 'upgrades': '[]',
                    'acknowledged_at': None, 'acknowledged_by': '',
                    'closed_at': now.isoformat() if status == 'closed' else None,
                    'closed_by': '压力夹具' if status == 'closed' else '',
                    'close_basis': '压力夹具已关闭' if status == 'closed' else '',
                    'created_at': now.isoformat(), 'updated_at': now.isoformat(),
                    'created_by': '压力夹具', 'updated_by': '压力夹具', 'revision': 1,
                })
                rows.append(event)
        columns = ','.join(f'"{key}"' for key in rows[0])
        values = ','.join(f':{key}' for key in rows[0])
        db.executemany(f'insert into events ({columns}) values ({values})', rows)
        db.commit()
        totals = {'points': db.execute('select count(*) from points').fetchone()[0],
                  'records': db.execute('select count(*) from records').fetchone()[0],
                  'events': db.execute('select count(*) from events').fetchone()[0],
                  'openEvents': db.execute("select count(*) from events where status!='closed'").fetchone()[0],
                  'activePoints': db.execute("select count(distinct point_id) from events where status!='closed'").fetchone()[0]}
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    (EVIDENCE / 'events.json').write_text(json.dumps({
        'method': 'Direct SQL fixture in independent stress DB; proves read/pagination only, not business writes.',
        'countsPerPoint': COUNTS, 'defaultCount': 1, 'nonZeroPoints': 45, 'expectedPages': 3,
        'totals': totals}, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(totals))


if __name__ == '__main__':
    main()
