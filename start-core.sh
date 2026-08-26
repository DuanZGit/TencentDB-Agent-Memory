#!/usr/bin/env bash
set -euo pipefail
export PATH=/opt/node22/bin:$PATH
set -a; source /opt/tencent-mem/hub.env; set +a
export TDAI_LLM_API_KEY="${TDAI_LLM_API_KEY:-${LLM_API_KEY:-}}"
export TDAI_LLM_BASE_URL="${TDAI_LLM_BASE_URL:-${LLM_BASE_URL:-}}"
cd /opt/tencent-mem/MemoryCore
TDAI_GATEWAY_PORT=8420 TDAI_GATEWAY_HOST=127.0.0.1 TDAI_GATEWAY_API_KEY="" \
TDAI_CONFIG_PATH=/opt/tencent-mem/MemoryCore/tdai-gateway.yaml \
exec node --import tsx src/gateway/server.ts
