#!/usr/bin/env python3
"""真实问题召回验证"""
import json, urllib.request

CORE = "http://127.0.0.1:8420/v3"
HDR = {
    "Content-Type": "application/json",
    "x-tdai-service-id": "default",
    "Authorization": "Bearer sk-mem-JyCtenmHTeObqoPkez_FhHL3M8fpZStk",
}

def search(query):
    req = urllib.request.Request(CORE + "/conversation/search",
        data=json.dumps({"query": query, "limit": 2}).encode(),
        headers=HDR, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        d = json.load(r)["data"]["messages"]
    for m in d:
        print(f"  [{m['score']:.2f}] {m['content'][:100].replace(chr(10),' ')}")

for q in ["NAS 外网怎么连接 端口", "股票报告的设计风格是什么", "DSH 派送任务会话持久怎么做的"]:
    print(f"\nQ: {q}")
    try:
        search(q)
    except Exception as e:
        print("  ERR:", e)
