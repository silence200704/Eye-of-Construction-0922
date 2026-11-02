"""Combined recheck helpers; reuses the established native UI automation."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[5]
sys.path.insert(0, str(ROOT / 'docs/implementation/evidence/stage8-engineer-review/scripts'))
import review_ui as r  # noqa: E402

r.EVIDENCE = ROOT / 'docs/implementation/evidence/stage8-engineer-gaps'
EVIDENCE = r.EVIDENCE
RUNTIME = r.RUNTIME


def save(relative, value):
    return r.save(relative, value)


def capture(name):
    return r.capture(name)


def expect(fragment, timeout=20):
    return r.expect(fragment, timeout=timeout)


def click(key, direction='down'):
    r.click(key, direction)


def click_text(value):
    r.click_text(value)


def replace(key, text, direction='up'):
    r.replace(key, text, direction)


def reveal(fragment, direction='up', attempts=8):
    return r.reveal(fragment, direction, attempts)


def back():
    r.back()


def connect(address):
    return r.connect(address)


def db_counts():
    return r.db_counts()


def data(path, role='safety'):
    token = r.session(role)
    try:
        return r.data(path, token)
    finally:
        r.logout(token)
