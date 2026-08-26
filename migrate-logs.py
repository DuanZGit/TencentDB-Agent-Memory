#!/usr/bin/env python3
"""把 Minis 每日日志批量导入腾讯记忆模块（L0），每天一个 session"""
import glob
import json
import os
import re
import sys
import urllib.request

CORE = "http://127.0.0.1:8420/v3"
HDR = {
    "Content-Type": "application/json",
    "x-tdai-service-id": "default",
    "Authorization": "Bearer sk-mem-JyCtenmHTeObqoPkez_FhHL3M8fpZStk",
}
LOG_DIR = "/tmp/minis-logs"
BATCH = 40


def post(path, body, timeout=60):
    req = urllib.request.Request(CORE + path, data=json.dumps(body).encode(),
                                 headers=HDR, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def parse_day(path):
    """返回 [(timestamp_or_empty, text), ...]"""
    s = open(path, encoding="utf-8").read()
    entries = []
    parts = re.split(r"<!--\s*([^>]+?)\s*-->", s)
    # parts[0] 是文件头（忽略）；之后成对：ts, body
    for i in range(1, len(parts) - 1, 2):
        ts = parts[i].strip()
        body = parts[i + 1].strip()
        if len(body) < 20:
            continue
        entries.append((ts, f"[{ts}]\n{body}" if ts else body))
    if not entries and len(s) > 50:
        # 无时间戳标记的文件整体作为一条
        entries.append(("", s))
    return entries


def main():
    files = sorted(glob.glob(os.path.join(LOG_DIR, "20*.md")))
    print(f"log files: {len(files)}")
    total_msgs = 0
    for path in files:
        day = re.search(r"(20\d{2}-\d{2}-\d{2})", os.path.basename(path))
        session_id = f"minis-log-{day.group(1) if day else 'unknown'}"
        entries = parse_day(path)
        if not entries:
            continue
        msgs = [{"role": "user", "content": e[1]} for e in entries]
        sent = 0
        for i in range(0, len(msgs), BATCH):
            batch = msgs[i : i + BATCH]
            try:
                res = post("/conversation/add", {
                    "session_id": session_id,
                    "messages": batch,
                })
                accepted = res.get("data", {}).get("total_count", 0)
                sent += accepted
            except Exception as e:
                print(f"  ERROR {session_id} batch {i//BATCH}: {e}", file=sys.stderr)
                return 1
        total_msgs += sent
        print(f"{os.path.basename(path)}: {len(entries)} entries -> {sent} accepted ({session_id})")
    print(f"DONE total={total_msgs}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
