"""Loopback-only inspection acceptance client. Tokens remain in process memory."""

import json
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
RUNTIME = ROOT / 'backend/.runtime-native-inspection'
EVIDENCE = ROOT / 'docs/implementation/evidence/stage8-inspection'


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


class Api:
    def __init__(self):
        self.base = 'http://127.0.0.1:18003/api/v1'
        self.tokens = {}
        self.sequence = 0

    def token(self, role):
        if role not in self.tokens:
            payload = json.dumps({'identityId': f'demo-{role}'}).encode()
            request = urllib.request.Request(f'{self.base}/demo/identity', data=payload,
                                             headers={'Content-Type': 'application/json'})
            with urllib.request.urlopen(request, timeout=15) as response:
                self.tokens[role] = json.load(response)['data']['accessToken']
        return self.tokens[role]

    def call(self, path, body=None, role='safety', key=None):
        self.sequence += 1
        headers = {'Authorization': f'Bearer {self.token(role)}', 'Content-Type': 'application/json',
                   'Idempotency-Key': key or f'inspection-accept-{id(self)}-{self.sequence}', 'X-Dataset-Epoch': '1'}
        request = urllib.request.Request(f'{self.base}/datasets/demo-main{path}',
                                         data=json.dumps(body).encode() if body is not None else None, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as response:
            return response.code, json.load(response)

    def data(self, path, body=None, role='safety', key=None):
        status, result = self.call(path, body, role, key)
        assert status == 200, (status, result)
        return result['data']

    def close(self):
        for token in self.tokens.values():
            request = urllib.request.Request(f'{self.base}/auth/logout', data=b'{}',
                                             headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'})
            with urllib.request.urlopen(request, timeout=15) as response:
                assert response.status == 200


def fixture():
    return json.loads((EVIDENCE / 'verification/fixture.json').read_text(encoding='utf-8'))
