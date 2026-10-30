import argparse
from http.server import ThreadingHTTPServer
from pathlib import Path

from scripts.mobile.completion.common import RUNTIME
from scripts.mobile.completion.media_hold import hold_media
from scripts.mobile.reporting.proxy import Proxy as BaseProxy


class Proxy(BaseProxy):
    upstream = "http://127.0.0.1:18010"
    runtime = RUNTIME

    def before_reply(self, status, data):
        if self.command == "GET" and status == 200:
            hold_media(self.runtime, self.path, data)


def main():
    parser = argparse.ArgumentParser(description="Isolated acceptance gateway, loopback only")
    parser.add_argument("--port", type=int, default=18011)
    parser.add_argument("--runtime", type=Path, default=RUNTIME)
    options = parser.parse_args()
    options.runtime.mkdir(parents=True, exist_ok=True)
    Proxy.runtime = options.runtime
    ThreadingHTTPServer(("127.0.0.1", options.port), Proxy).serve_forever()


if __name__ == "__main__":
    main()
