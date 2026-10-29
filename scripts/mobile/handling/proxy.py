"""Drop one successful response after commit, exclusively in isolated acceptance."""
from http.server import ThreadingHTTPServer
from scripts.mobile.reporting.proxy import Proxy as ReportProxy
from scripts.mobile.handling.common import RUNTIME


class Proxy(ReportProxy):
    upstream = 'http://127.0.0.1:18008'
    runtime = RUNTIME


if __name__ == '__main__':
    print('Isolated handling gateway 18009 -> 18008', flush=True)
    ThreadingHTTPServer(('127.0.0.1', 18009), Proxy).serve_forever()
