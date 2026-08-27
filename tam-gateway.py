#!/usr/bin/env python3
# tam-gateway.py — TAM agent gateway（统一对外入口）
# 给所有 agent（pi / Minis / dsh / Claude Code …）提供：
#   - 任务队列:  /api/v1/dispatch/*       → hub MemoryPanel (8125)   GET+POST
#   - 记忆读写:  /v3/conversation/{search,add,count} → core (8420)  POST
# 统一鉴权: X-Tam-Key 头；非白名单一律 404、无 key 一律 401。
#
# 环境变量：
#   TAM_PI_TOKEN  客户端必须携带的 X-Tam-Key 值（必填）
#   LISTEN_PORT   监听端口（默认 8430）
#   HUB_PORT      hub 端口（默认 8125）
#   CORE_PORT     core gateway 端口（默认 8420）

import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib import request, error

TOKEN = os.environ.get("TAM_PI_TOKEN", "")
LISTEN_PORT = int(os.environ.get("LISTEN_PORT", "8430"))
HUB_PORT = int(os.environ.get("HUB_PORT", "8125"))
CORE_PORT = int(os.environ.get("CORE_PORT", "8420"))
HUB_BASE = f"http://127.0.0.1:{HUB_PORT}"
CORE_BASE = f"http://127.0.0.1:{CORE_PORT}"

# 路由表: 前缀 -> (转发基址, 允许方法)
ROUTES = [
    ("/api/v1/dispatch", HUB_BASE, {"GET", "POST"}),
    ("/v3/conversation", CORE_BASE, {"POST"}),
]

if not TOKEN:
    print("FATAL: TAM_PI_TOKEN not set", file=sys.stderr)
    sys.exit(1)

def match_route(path: str):
    for prefix, base, methods in ROUTES:
        if path.startswith(prefix):
            return base, methods, prefix
    return None

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        sys.stderr.write("[tam-gateway] %s %s\n" % (self.address_string(), fmt % args))

    def _auth_ok(self) -> bool:
        return self.headers.get("X-Tam-Key") == TOKEN

    def _send(self, code: int, body: bytes, ctype: str = "application/json"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        # CORS: 允许任意浏览器跨域（网关仅暴露白名单路由 + X-Tam-Key 鉴权，安全可控）
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "X-Tam-Key, Content-Type")
        self.send_header("Access-Control-Max-Age", "86400")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._send(204, b"")

    def do_GET(self):
        if self.path == "/health":
            self._send(200, b'{"status":"ok","gateway":"tam"}')
            return
        r = match_route(self.path)
        if not r or "GET" not in r[1]:
            self._send(404, b'{"error":"route not allowed"}')
            return
        if not self._auth_ok():
            self._send(401, b'{"error":"unauthorized"}')
            return
        base, _, _ = r
        self._forward(base, self.path, None)

    def do_POST(self):
        if not self._auth_ok():
            self._send(401, b'{"error":"unauthorized"}')
            return
        r = match_route(self.path)
        if not r or "POST" not in r[1]:
            self._send(404, b'{"error":"route not allowed"}')
            return
        length = int(self.headers.get("Content-Length", "0"))
        payload = self.rfile.read(length) if length > 0 else b"{}"
        base, _, _ = r
        self._forward(base, self.path, payload)

    def _forward(self, base: str, path: str, payload):
        """转发到后端。dispatch 走 hub（透传原 header），conversation 走 core（注入固定 header）。"""
        if base == HUB_BASE:
            headers = {k: v for k, v in self.headers.items() if k.lower() in
                       ("content-type", "authorization", "x-tdai-user-key", "x-tdai-service-id")}
            headers.setdefault("Content-Type", "application/json")
        else:
            headers = {
                "Content-Type": "application/json",
                "x-tdai-service-id": "default",
                "Authorization": "Bearer sk-tam-pi-bridge",
            }
        try:
            req = request.Request(base + path, data=payload, method=self.command, headers=headers)
            with request.urlopen(req, timeout=60) as resp:
                body = resp.read()
                self._send(resp.status, body, resp.headers.get("Content-Type", "application/json"))
        except error.HTTPError as e:
            body = e.read()
            self._send(e.code, body, "application/json")
        except Exception as e:
            self._send(502, ('{"error":"upstream failed: %s"}' % e).encode())

def main():
    srv = ThreadingHTTPServer(("0.0.0.0", LISTEN_PORT), Handler)
    print(f"[tam-gateway] listening on 0.0.0.0:{LISTEN_PORT} (dispatch->:{HUB_PORT}, conv->:{CORE_PORT})")
    srv.serve_forever()

if __name__ == "__main__":
    main()