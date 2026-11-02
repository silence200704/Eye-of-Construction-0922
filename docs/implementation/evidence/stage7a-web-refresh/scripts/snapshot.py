"""Read-only deployed dataset counters and media hashes; excludes volatile session/receipt counts."""

import hashlib
import json
import sqlite3
from pathlib import Path

root = Path('/data')
db = sqlite3.connect('file:/data/zhutong.sqlite?mode=ro', uri=True)
names = [row[0] for row in db.execute('SELECT name FROM sqlite_master WHERE type=?', ('table',))]
volatile = {'login_sessions', 'audits', 'operation_receipts'}
counts = {name: db.execute(f'SELECT count(*) FROM [{name}]').fetchone()[0]
          for name in names if name not in volatile and not name.startswith('sqlite_')}
files = {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
         for p in (root / 'media/files').rglob('*') if p.is_file()}
print(json.dumps({'counts': counts, 'media': files}))
db.close()
