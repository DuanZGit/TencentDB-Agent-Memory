#!/usr/bin/env python3
"""dsh-dispatch-worker v3 — 真·会话复用版（依赖 headless bundle 的 DSH_SESSION_ID 补丁）。

认领 dispatch 队列中 to=dsh 的任务并执行：
  - 每个 from_agent(+session_id) 派生一个稳定的 DSH 会话 ID，
    通过 DSH_SESSION_ID 环境变量让 headless 复用/锁定同一会话 ——
    上下文连续由 DSH 自身的会话持久化保证，不再伪造历史注入
  - DSH_SESSION_TAG 给新会话打标题标记 [dispatch:<key>]，便于在 DSH 里识别
  - session.chat / 默认   → DSH headless（会话复用）
  - exec.shell            → 本机 bash -c
  - type 前缀为 session.new 或 payload 以 [NEW] 开头 → 强制开新会话（ID 加时间戳后缀）
"""
import json
import os
import re
import subprocess
import time
import urllib.request

PANEL = "http://127.0.0.1:8125/api/v1/dispatch"
DSH_CLI = "/home/duanz/dsh-src/apps/cli/lib/bin.js"
STATE_PATH = "/opt/tencent-mem/data/dsh-sessions.json"
TASK_TIMEOUT = 240


def load_state():
    try:
        with open(STATE_PATH) as f:
            return json.load(f)
    except Exception:
        return {}


def save_state(state):
    tmp = STATE_PATH + ".tmp"
    with open(tmp, "w") as f:
        json.dump(state, f, ensure_ascii=False, indent=1)
    os.replace(tmp, STATE_PATH)


def post(path, body):
    req = urllib.request.Request(
        PANEL + path,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.load(r)


def dsh_session_id(sess_key, force_new=False):
    """from_agent:session -> 稳定的 DSH 会话 ID；force_new 追加时间戳换新会话。"""
    base = "dispatch-" + re.sub(r"[^a-zA-Z0-9_-]", "-", sess_key)
    if force_new:
        base += "-" + str(int(time.time()))
    return base


def run_dsh(prompt, sess_key, force_new=False):
    sid = dsh_session_id(sess_key, force_new)
    env = dict(
        os.environ,
        DSH_SESSION_ID=sid,
        DSH_SESSION_TAG=f"dispatch:{sess_key}",
    )
    try:
        p = subprocess.run(
            ["node", DSH_CLI, "--profile", "headless", prompt],
            capture_output=True, text=True, timeout=TASK_TIMEOUT,
            cwd="/home/duanz/dsh-src", env=env,
        )
        out = (p.stdout or "") + (p.stderr or "")
        out = re.sub(r"<think>[\s\S]*?</think>\s*", "", out)
        i = out.find("<think>")
        if i != -1:
            out = out[:i]
        return out.strip()[-3000:] if out.strip() else "(empty output)", sid
    except subprocess.TimeoutExpired:
        return f"(timeout after {TASK_TIMEOUT}s)", sid


def run_shell(payload):
    try:
        p = subprocess.run(["bash", "-c", payload], capture_output=True,
                           text=True, timeout=60)
        out = (p.stdout or "") + (p.stderr or "")
        return out.strip()[-2000:] if out.strip() else "(empty output)"
    except subprocess.TimeoutExpired:
        return "(timeout after 60s)"


def main():
    print("dsh-dispatch-worker v3 (real-session-reuse) started", flush=True)
    state = load_state()
    while True:
        try:
            res = post("/claim", {"to": "dsh"})
            task = res.get("data", {}).get("task")
            if not task:
                time.sleep(5)
                continue

            tid = task["id"]
            ttype = task.get("type", "session.chat")
            payload = task.get("payload", "")
            sender = task.get("from_agent", "unknown")
            sess_key = f"{sender}:{task.get('session_id') or 'default'}"
            print(f"[claim] {tid} type={ttype} from={sender}", flush=True)

            force_new = ttype.startswith("session.new") or payload.startswith("[NEW]")
            if force_new:
                payload = payload.replace("[NEW]", "", 1).strip()

            if ttype == "exec.shell":
                result = run_shell(payload)
            else:
                result, sid = run_dsh(payload, sess_key, force_new)
                # 记录映射便于观测；真正的上下文锁在 DSH 会话本身
                if state.get(sess_key) != sid:
                    state[sess_key] = sid
                    save_state(state)

            post("/update", {"id": tid, "status": "done", "result": result})
            print(f"[done] {tid} -> {result[:120]}", flush=True)
        except Exception as e:  # noqa: BLE001
            print(f"[error] {e}", flush=True)
            time.sleep(10)


if __name__ == "__main__":
    main()
