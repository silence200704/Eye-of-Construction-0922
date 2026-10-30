"""Loopback report gateway with explicit one-response loss after real upstream commit."""

import hashlib
import json
import socket
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from scripts.mobile.reporting.common import RUNTIME


class Proxy(BaseHTTPRequestHandler):
    upstream = "http://127.0.0.1:18005"
    runtime = RUNTIME

    def log_message(self, *_):
        pass

    def before_reply(self, status, data):
        """Isolated subclasses may delay a response; ordinary forwarding is unchanged."""
        pass

    def forward(self):
        payload = (
            self.rfile.read(int(self.headers.get("Content-Length", 0)))
            if self.command == "POST"
            else None
        )
        headers = {
            key: value
            for key, value in self.headers.items()
            if key.lower() not in ["host", "connection", "content-length"]
        }
        request = urllib.request.Request(
            f"{self.upstream}{self.path}", data=payload, headers=headers, method=self.command
        )
        try:
            response = urllib.request.urlopen(request, timeout=20)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            status, data, mime = (
                response.status,
                response.read(),
                response.headers.get("Content-Type", "application/json"),
            )
        marker = self.runtime / "drop-response.json"
        if self.command == "POST" and status in [200, 201] and marker.exists():
            pending = json.loads(marker.read_text(encoding="utf-8"))
            if self.path.startswith(pending["path"]):
                marker.unlink()
                record = {
                    "path": self.path,
                    "status": status,
                    "key": self.headers.get("Idempotency-Key"),
                    "bodySha256": hashlib.sha256(payload).hexdigest(),
                    "afterCommit": True,
                }
                (self.runtime / "dropped-response.json").write_text(
                    json.dumps(record), encoding="utf-8"
                )
                self.connection.shutdown(socket.SHUT_RDWR)
                self.connection.close()
                return
        self.before_reply(status, data)
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    do_GET = forward
    do_POST = forward


if __name__ == "__main__":
    print("Isolated report gateway 18006 -> 18005", flush=True)
    ThreadingHTTPServer(("127.0.0.1", 18006), Proxy).serve_forever()
