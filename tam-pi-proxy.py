#!/usr/bin/env python3
# tam-pi-proxy.py — TAM core 白名单反代（只给 pi coding agent 用）
# 监听 0.0.0.0:8430，只放行 conversation 三条路由，校验 X-Tam-Key
# 转发到 127.0.0.1:8420（core gateway），并注入 core 侧所需固定 headers。
#
# 环境变量:
#   TAM_PI_TOKEN  客户端必须携带的 X-Tam-Key 值（必填）
#   LISTEN_PORT   监听端口（默认 8430）
#   CORE_PORT     core gateway 端口（默认 8420）
#
# 安全设计：core 保持 127.0.0.1 + auth off 现状不动（hub/knowledge/memhub 零影响），
# 暴露面由本代理收敛：任何其它路径一律 404，鉴权失败一律 401。

import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib import request, error

TOKEN = os.environ.get("TAM_PI_TOKEN", "")
LISTEN_PORT = int(os.environ.get("LISTEN_PORT", "8430"))
CORE_PORT = int(os.environ.get("CORE_PORT", "8420"))
CORE_BASE = f"http://127.0.0.1:{CORE_PORT}"

ALLOWED = {
    "/v3/conversation/search",
    "/v3/conversation/add",
    "/v3/conversation/count",
}

if not TOKEN:
    print("FATAL: TAM_PI_TOKEN not set", file=sys.stderr)
    sys.exit(1)

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        sys.stderr.write("[tam-pi-proxy] %s %s\n" % (self.address_string(), fmt % args))

    def do_GET(self):
        if self.path == "/health":
            body = b'{"status":"ok","proxy":"tam-pi"}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_response(404)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_POST(self):
        # 1) 鉴权
        if self.headers.get("X-Tam-Key") != TOKEN:
            body = b'{"error":"unauthorized"}'
            self.send_response(401)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        # 2) 白名单
        if self.path not in ALLOWED:
            body = b'{"error":"route not allowed"}'
            self.send_response(404)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        # 3) 读 body
        length = int(self.headers.get("Content-Length", "0"))
        payload = self.rfile.read(length) if length > 0 else b"{}"
        # 4) 转发到 core（注入 core 侧 headers，客户端无需关心）
        req = request.Request(
            CORE_BASE + self.path,
            data=payload,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "x-tdai-service-id": "default",
                "Authorization": "Bearer sk-tam-pi-bridge",
            },
        )
        try:
            with request.urlopen(req, timeout=60) as resp:
                body = resp.read()
                self.send_response(resp.status)
                self.send_header("Content-Type", resp.headers.get("Content-Type", "application/json"))
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
        except error.HTTPError as e:
            body = e.read()
            self.send_response(e.code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except Exception as e:
            body = ('{"error":"upstream failed: %s"}' % e).encode()
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

def main():
    srv = ThreadingHTTPServer(("0.0.0.0", LISTEN_PORT), Handler)
    print(f"[tam-pi-proxy] listening on 0.0.0.0:{LISTEN_PORT} -> core :{CORE_PORT}")
    srv.serve_forever()

if __name__ == "__main__":
    main()