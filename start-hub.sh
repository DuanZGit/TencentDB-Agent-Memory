#!/usr/bin/env bash
set -euo pipefail
export PATH=/opt/node22/bin:$PATH
set -a; source /opt/tencent-mem/hub.env; set +a
PANEL_PORT=8125
KNOWLEDGE_PORT=8424
LOG_DIR=/opt/tencent-mem/data/logs
mkdir -p "$LOG_DIR"
cd /opt/tencent-mem/MemoryKnowledge
PORT=$KNOWLEDGE_PORT LOG_LEVEL=info node dist/server.mjs >> "$LOG_DIR/knowledge.log" 2>&1 &
KS_PID=$!
for i in $(seq 1 60); do curl -fsS http://127.0.0.1:$KNOWLEDGE_PORT/health >/dev/null 2>&1 && break; sleep 0.5; done
cd /opt/tencent-mem/MemoryPanel
HOST=0.0.0.0 PORT=$PANEL_PORT UI_DIST_DIR=/opt/tencent-mem/MemoryPanel/web/dist \
METADATA_INSTANCES_CONFIG=/opt/tencent-mem/MemoryPanel/config/metadata-instances.json \
KNOWLEDGE_SERVICE_URL=http://127.0.0.1:$KNOWLEDGE_PORT KNOWLEDGE_TIMEOUT_MS=15000 \
KNOWLEDGE_LLM_BINDING_SYNC=1 LOG_LEVEL=info node dist/index.js >> "$LOG_DIR/panel.log" 2>&1 &
wait
