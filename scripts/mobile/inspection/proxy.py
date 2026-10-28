"""Forward only to the isolated loopback API; drop one committed response for retry evidence."""

import json
import socket
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from http_api import RUNTIME


class Proxy(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def forward(self):
        payload = self.rfile.read(int(self.headers.get('Content-Length', 0))) if self.command == 'POST' else None
        headers = {key: value for key, value in self.headers.items()
                   if key.lower() not in ['host', 'connection', 'content-length']}
        request = urllib.request.Request(f'http://127.0.0.1:18003{self.path}', data=payload,
                                         headers=headers, method=self.command)
        try:
            response = urllib.request.urlopen(request, timeout=15)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            status, data = response.status, response.read()
        marker = RUNTIME / 'drop-response.json'
        if self.command == 'POST' and status == 200 and marker.exists():
            pending = json.loads(marker.read_text(encoding='utf-8'))
            if self.path == pending['path']:
                marker.unlink()
                public = {'method': self.command, 'path': self.path, 'upstreamStatus': status,
                          'action': 'Response dropped after upstream committed',
                          'idempotencyKey': self.headers.get('Idempotency-Key')}
                (RUNTIME / 'dropped-response.json').write_text(json.dumps(public), encoding='utf-8')
                self.connection.shutdown(socket.SHUT_RDWR)
                self.connection.close()
                return
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    do_GET = forward
    do_POST = forward


if __name__ == '__main__':
    print('Native acceptance gateway on loopback 18004 -> isolated API 18003', flush=True)
    ThreadingHTTPServer(('127.0.0.1', 18004), Proxy).serve_forever()
