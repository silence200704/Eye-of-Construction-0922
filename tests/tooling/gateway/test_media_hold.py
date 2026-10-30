"""Real loopback gateway tests, with synthetic media and no application database."""

import hashlib
import http.client
import json
import sys
import tempfile
import threading
import time
import unittest
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from scripts.mobile.completion import proxy as proxy_module  # noqa: E402
from scripts.mobile.completion.proxy import Proxy  # noqa: E402

MEDIA = "/api/v1/datasets/demo-main/media/test-media/content"
BODY = b"synthetic-photo-bytes"


class Upstream(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        self.send_response(403 if self.path.endswith("denied/content") else 200)
        self.send_header("Content-Length", str(len(BODY)))
        self.end_headers()
        self.wfile.write(BODY)

    do_POST = do_GET


class MediaHoldTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.runtime = Path(self.temp.name)
        self.upstream = ThreadingHTTPServer(("127.0.0.1", 0), Upstream)
        handler = type(
            "IsolatedProxy",
            (Proxy,),
            {
                "upstream": f"http://127.0.0.1:{self.upstream.server_port}",
                "runtime": self.runtime,
            },
        )
        self.gateway = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        for server in [self.upstream, self.gateway]:
            threading.Thread(target=server.serve_forever, daemon=True).start()
            self.addCleanup(server.server_close)
            self.addCleanup(server.shutdown)

    def arm(self, **values):
        request = {"path": MEDIA, "gateId": "test-gate", "timeoutSeconds": 2, **values}
        (self.runtime / "hold-media.json").write_text(json.dumps(request), encoding="utf-8")

    def fetch(self, path=MEDIA):
        with urllib.request.urlopen(
            f"http://127.0.0.1:{self.gateway.server_port}{path}", timeout=4
        ) as response:
            return response.read()

    def wait_held(self):
        deadline = time.monotonic() + 1
        while time.monotonic() < deadline:
            path = self.runtime / "held-media.json"
            if path.exists():
                return json.loads(path.read_text(encoding="utf-8"))
            time.sleep(0.01)
        self.fail("Media request never entered the configured hold")

    def release(self, gate_id):
        (self.runtime / "release-media.json").write_text(
            json.dumps({"gateId": gate_id}), encoding="utf-8"
        )

    def test_bytes_are_held_until_matching_release_and_other_requests_still_work(self):
        self.arm()
        with ThreadPoolExecutor() as pool:
            pending = pool.submit(self.fetch)
            held = self.wait_held()
            self.assertFalse(pending.done())
            self.assertEqual(held["sha256"], hashlib.sha256(BODY).hexdigest())
            self.assertNotIn("Authorization", held)
            self.assertEqual(self.fetch("/api/v1/auth/me"), BODY)
            self.assertEqual(self.fetch(), BODY)
            self.assertFalse(pending.done())
            self.release("stale-gate")
            time.sleep(0.08)
            self.assertFalse(pending.done())
            self.release("test-gate")
            self.assertEqual(pending.result(timeout=2), BODY)
        self.assertFalse((self.runtime / "hold-media.json").exists())
        self.assertFalse((self.runtime / "active-media.json").exists())
        self.assertEqual(self.fetch(), BODY)

    def test_hold_times_out_and_preserves_exact_bytes(self):
        self.arm(timeoutSeconds=0.1)
        self.assertEqual(self.fetch(), BODY)
        result = json.loads((self.runtime / "held-media.json").read_text(encoding="utf-8"))
        self.assertEqual(result["outcome"], "timeout")

    def test_invalid_or_non_media_configuration_is_inert(self):
        for values in [
            {"path": "/api/v1/auth/me"},
            {"timeoutSeconds": 9},
            {"timeoutSeconds": True},
        ]:
            self.arm(**values)
            self.assertEqual(self.fetch(), BODY)
            self.assertFalse((self.runtime / "held-media.json").exists())
        (self.runtime / "hold-media.json").write_text("{", encoding="utf-8")
        self.assertEqual(self.fetch(), BODY)

    def test_denied_media_is_never_held(self):
        path = "/api/v1/datasets/demo-main/media/denied/content"
        self.arm(path=path)
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.fetch(path)
        self.assertEqual(caught.exception.code, 403)
        caught.exception.close()
        self.assertFalse((self.runtime / "held-media.json").exists())

    def test_post_is_not_held_and_committed_response_loss_still_works(self):
        self.arm()
        request = urllib.request.Request(
            f"http://127.0.0.1:{self.gateway.server_port}{MEDIA}", data=b"fixed-body", method="POST"
        )
        with urllib.request.urlopen(request, timeout=2) as response:
            self.assertEqual(response.read(), BODY)
        self.assertTrue((self.runtime / "hold-media.json").exists())
        (self.runtime / "drop-response.json").write_text(
            json.dumps({"path": MEDIA}), encoding="utf-8"
        )
        with self.assertRaises(http.client.RemoteDisconnected):
            urllib.request.urlopen(request, timeout=2)
        record = json.loads((self.runtime / "dropped-response.json").read_text(encoding="utf-8"))
        self.assertTrue(record["afterCommit"])
        self.assertEqual(record["bodySha256"], hashlib.sha256(b"fixed-body").hexdigest())
        self.assertFalse((self.runtime / "held-media.json").exists())

    def test_cli_uses_a_separate_loopback_port_and_runtime(self):
        runtime = self.runtime / "separate"
        arguments = ["proxy", "--port", "18014", "--runtime", str(runtime)]
        original = Proxy.runtime
        try:
            with mock.patch.object(sys, "argv", arguments):
                with mock.patch.object(proxy_module, "ThreadingHTTPServer") as server:
                    proxy_module.main()
                    server.assert_called_once_with(("127.0.0.1", 18014), Proxy)
                    server.return_value.serve_forever.assert_called_once_with()
                    self.assertEqual(Proxy.runtime, runtime)
                    self.assertTrue(runtime.is_dir())
        finally:
            Proxy.runtime = original


if __name__ == "__main__":
    unittest.main()
