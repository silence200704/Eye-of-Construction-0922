from http.server import ThreadingHTTPServer
from scripts.mobile.reporting.proxy import Proxy as BaseProxy
from scripts.mobile.completion.common import RUNTIME


class Proxy(BaseProxy):
    upstream = 'http://127.0.0.1:18010'
    runtime = RUNTIME


if __name__ == '__main__':
    ThreadingHTTPServer(('127.0.0.1', 18011), Proxy).serve_forever()
