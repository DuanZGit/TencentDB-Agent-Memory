#!/usr/bin/env python3
"""dsh-dispatch-worker v2 — 会话持久版。

认领 dispatch 队列中 to=dsh 的任务并执行：
  - 每个 from_agent（+可选 task.session_id）维护一条滚动对话历史，
    每次执行把历史注入 prompt，实现跨任务的上下文连续
  - session.chat / 默认   → DSH headless（带历史）
  - exec.shell            → 本机 bash -c
  - type 前缀为 session.new 或 payload 以 [NEW] 开头 → 强制开新会话
"""
import json
import os
import subprocess
import time
import urllib.request

PANEL = "http://127.0.0.1:8125/api/v1/dispatch"
DSH_CLI = "/home/duanz/dsh-src/apps/cli/lib/bin.js"
STATE_PATH = "/opt/tencent-mem/data/dsh-sessions.json"
TASK_TIMEOUT = 240
MAX_HISTORY_CHARS = 12000


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


def run_dsh(prompt):
    try:
        p = subprocess.run(
            ["node", DSH_CLI, "--profile", "headless", prompt],
            capture_output=True, text=True, timeout=TASK_TIMEOUT,
            cwd="/home/duanz/dsh-src",
        )
        out = (p.stdout or "") + (p.stderr or "")
        return out.strip()[-3000:] if out.strip() else "(empty output)"
    except subprocess.TimeoutExpired:
        return f"(timeout after {TASK_TIMEOUT}s)"


def run_shell(payload):
    try:
        p = subprocess.run(["bash", "-c", payload], capture_output=True,
                           text=True, timeout=60)
        out = (p.stdout or "") + (p.stderr or "")
        return out.strip()[-2000:] if out.strip() else "(empty output)"
    except subprocess.TimeoutExpired:
        return "(timeout after 60s)"


def build_prompt(history, payload):
    if not history:
        return payload
    lines = []
    for h in history[-6:]:
        lines.append(f"[任务] {h['q'][:500]}")
        lines.append(f"[回复] {h['a'][:800]}")
    hist = "\n".join(lines)[-MAX_HISTORY_CHARS:]
    return (
        "以下是本会话此前的交互记录（供延续上下文，不要重复回答）：\n"
        f"{hist}\n\n---\n新任务：{payload}"
    )


def main():
    print("dsh-dispatch-worker v2 (session-persistent) started", flush=True)
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
                state.pop(sess_key, None)

            if ttype == "exec.shell":
                result = run_shell(payload)
                result_preview = result
            else:
                hist = state.get(sess_key, [])
                answer = run_dsh(build_prompt(hist, payload))
                hist.append({"q": payload, "a": answer})
                while sum(len(h["q"]) + len(h["a"]) for h in hist) > MAX_HISTORY_CHARS * 2:
                    hist.pop(0)
                state[sess_key] = hist
                save_state(state)
                result = answer
                result_preview = answer[:120]

            post("/update", {"id": tid, "status": "done", "result": result})
            print(f"[done] {tid} -> {result_preview}", flush=True)
        except Exception as e:  # noqa: BLE001
            print(f"[error] {e}", flush=True)
            time.sleep(10)


if __name__ == "__main__":
    main()
