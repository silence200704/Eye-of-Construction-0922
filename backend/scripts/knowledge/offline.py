"""新进程冷启动；进程级禁止所有出站连接，不改整台电脑网络。"""

import argparse
import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

import httpx
from client import Client
from evaluate import evaluate


def memory_mb() -> float:
    if os.name != "nt":
        import resource

        return round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 2)
    import ctypes
    from ctypes import wintypes

    class Counters(ctypes.Structure):
        _fields_ = [("cb", wintypes.DWORD), ("faults", wintypes.DWORD)] + [
            (name, ctypes.c_size_t) for name in ("peak", "rss", "p1", "p2", "p3", "p4", "p5", "p6")
        ]

    counters = Counters()
    counters.cb = ctypes.sizeof(counters)
    ctypes.windll.kernel32.GetCurrentProcess.restype = wintypes.HANDLE
    memory = ctypes.windll.psapi.GetProcessMemoryInfo
    memory.argtypes = [wintypes.HANDLE, ctypes.POINTER(Counters), wintypes.DWORD]
    if not memory(ctypes.windll.kernel32.GetCurrentProcess(), ctypes.byref(counters), counters.cb):
        raise OSError("无法读取进程内存")
    return round(counters.rss / 1024 / 1024, 2)


def serve(args):
    import uvicorn

    from zhutong.domain.knowledge.model import get_encoder

    attempts = []

    def deny(event, values):
        if event in {"socket.connect", "socket.getaddrinfo"}:
            address = values[1][0] if event == "socket.connect" else values[0]
            if address in {"127.0.0.1", "::1", "localhost"}:
                return
            attempts.append(event)
            (args.runtime / "blocked-network.json").write_text(
                json.dumps(attempts), encoding="utf-8"
            )
            raise OSError("阶段 6 离线验证：禁止出站连接和 DNS")

    sys.addaudithook(deny)
    try:
        socket.socket().connect(("192.0.2.1", 443))
    except OSError:
        pass
    start = time.perf_counter()
    encoder = get_encoder(args.runtime)
    vector = encoder.encode(["维修工单验收流程"], query=True)
    stats = {
        "coldModelAndFirstEncodingMs": round((time.perf_counter() - start) * 1000, 2),
        "dimension": vector.shape[1],
        "memoryAfterModelMB": memory_mb(),
        "networkGuardProbeBlocked": True,
    }
    (args.runtime / "offline-performance.json").write_text(json.dumps(stats), encoding="utf-8")
    uvicorn.run(
        "zhutong.app:create_app",
        factory=True,
        host="127.0.0.1",
        port=args.port,
        log_level="warning",
    )


def verify(args):
    env = {
        **os.environ,
        "ZHUTONG_RUNTIME_DIR": str(args.runtime),
        "ZHUTONG_DATABASE_URL": f"sqlite:///{(args.runtime / 'zhutong.sqlite').as_posix()}",
        "HF_HUB_OFFLINE": "1",
        "TRANSFORMERS_OFFLINE": "1",
    }
    command = [
        sys.executable,
        __file__,
        "--serve",
        "--runtime",
        str(args.runtime),
        "--port",
        str(args.port),
    ]
    with (args.runtime / "offline-server.log").open("w", encoding="utf-8") as log:
        process = subprocess.Popen(command, env=env, stdout=log, stderr=log)
    try:
        wait_ready(args.port, process)
        client = Client(f"http://127.0.0.1:{args.port}")
        try:
            result = evaluate(
                client, Path(__file__).resolve().parents[2] / "resources/knowledge/acceptance.json"
            )
            result["status"] = client.get("/status")
        finally:
            client.close()
        result["performance"] = json.loads((args.runtime / "offline-performance.json").read_text())
        attempts = json.loads((args.runtime / "blocked-network.json").read_text())
        result["applicationNetworkAttempts"] = len(attempts) - 1
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        print(
            json.dumps(
                {key: value for key, value in result.items() if key != "results"}, ensure_ascii=True
            )
        )
    finally:
        process.terminate()
        process.wait(timeout=15)


def wait_ready(port: int, process):
    with httpx.Client(trust_env=False, timeout=1) as client:
        for _ in range(100):
            if process.poll() is not None:
                raise RuntimeError("离线服务提前退出，请检查 offline-server.log")
            try:
                response = client.get(f"http://127.0.0.1:{port}/api/v1/health/ready")
                if response.status_code == 200:
                    return
            except httpx.HTTPError:
                pass
            time.sleep(0.2)
    raise RuntimeError("离线服务启动超时")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--port", type=int, default=18002)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--serve", action="store_true")
    args = parser.parse_args()
    args.runtime = args.runtime.resolve()
    serve(args) if args.serve else verify(args)
