#!/usr/bin/env python3
"""查看 dsh 队列最近任务状态"""
import json, sys, urllib.request
with urllib.request.urlopen("http://127.0.0.1:8125/api/v1/dispatch/list?to=dsh&limit=5", timeout=10) as r:
    d = json.load(r)
for t in d["data"]["tasks"]:
    print(f"{t['status']:8} | {t['id']} | {(t.get('result') or '')[:150].replace(chr(10), ' / ')}")
