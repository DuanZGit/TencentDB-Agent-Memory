/**
 * /api/v1/dispatch/* —— 跨 Agent 任务派送收件箱（D-Hub 合并能力）。
 *
 * 设计：
 *   - 每个 to_agent 一条 FIFO 队列；send 入队、claim 原子认领、update 回写结果
 *   - 存储用 node:sqlite（Node >=22.5 内置），文件路径由 env DISPATCH_DB_PATH 控制
 *   - 与内核 Team/Agent 模型解耦：agent 用字符串标识即可互通，
 *     Minis / DSH / Claude Code 都能直接 REST 调用，无需注册流程
 *
 * 端点：
 *   POST /api/v1/dispatch/send    { from, to, type, payload, team_id? }
 *   POST /api/v1/dispatch/claim   { to }
 *   POST /api/v1/dispatch/update  { id, status, result?, to }
 *   GET  /api/v1/dispatch/list?to=&status=&limit=
 *   GET  /api/v1/dispatch/stats
 */
import { Hono, type Context } from "hono";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import type { PanelDeps } from "../../panel-deps.js";

const VALID_STATUS = new Set(["queued", "running", "done", "failed"]);

let db: DatabaseSync | null = null;

function getDb(): DatabaseSync {
  if (db) return db;
  const dbPath =
    process.env.DISPATCH_DB_PATH || "/data/knowledge/dispatch.db";
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS dispatch_tasks (
      id TEXT PRIMARY KEY,
      team_id TEXT DEFAULT '',
      from_agent TEXT NOT NULL,
      to_agent TEXT NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      result TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      claimed_at TEXT,
      finished_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_dispatch_to_status ON dispatch_tasks(to_agent, status, created_at);
  `);
  return db;
}

interface DispatchTask {
  id: string;
  team_id: string;
  from_agent: string;
  to_agent: string;
  type: string;
  payload: string;
  status: string;
  result?: string | null;
  created_at: string;
  updated_at: string;
  claimed_at?: string | null;
  finished_at?: string | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function genId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `disp_${ts}_${rand}`;
}

function ok<T>(c: Context, data: T) {
  return c.json({ code: 0, message: "ok", request_id: c.get("reqId") ?? "", data });
}
function fail(c: Context, status: number, message: string) {
  return c.json({ code: status, message, request_id: c.get("reqId") ?? "", data: null }, status as 400);
}

export function registerDispatchRoutes(api: Hono, _deps: PanelDeps): void {
  // send —— 入队
  api.post("/dispatch/send", async (c) => {
    const body = await c.req.json().catch(() => null);
    const b = body as { from?: string; to?: string; type?: string; payload?: unknown; team_id?: string } | null;
    if (!b?.from?.trim() || !b?.to?.trim()) return fail(c, 400, "from 和 to 必填");
    if (!b?.type?.trim()) return fail(c, 400, "type 必填");
    if (b.payload === undefined || b.payload === null) return fail(c, 400, "payload 必填");
    const d = getDb();
    const id = genId();
    const now = nowIso();
    const payload = typeof b.payload === "string" ? b.payload : JSON.stringify(b.payload);
    d.prepare(
      `INSERT INTO dispatch_tasks (id, team_id, from_agent, to_agent, type, payload, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
    ).run(id, b.team_id?.trim() || "", b.from.trim(), b.to.trim(), b.type.trim(), payload, now, now);
    return ok(c, { id, status: "queued" });
  });

  // claim —— 原子认领该 agent 队列中最早的 queued 任务
  api.post("/dispatch/claim", async (c) => {
    const body = await c.req.json().catch(() => null);
    const to = (body as { to?: string } | null)?.to?.trim();
    if (!to) return fail(c, 400, "to 必填");
    const d = getDb();
    const row = d.prepare(
      `SELECT * FROM dispatch_tasks WHERE to_agent = ? AND status = 'queued' ORDER BY created_at ASC LIMIT 1`,
    ).get(to) as DispatchTask | undefined;
    if (!row) return ok(c, { task: null });
    const now = nowIso();
    d.prepare(`UPDATE dispatch_tasks SET status='running', claimed_at=?, updated_at=? WHERE id=? AND status='queued'`).run(now, now, row.id);
    return ok(c, { task: { ...row, status: "running", claimed_at: now, updated_at: now } });
  });

  // update —— 状态流转 + 结果回写
  api.post("/dispatch/update", async (c) => {
    const body = await c.req.json().catch(() => null);
    const b = body as { id?: string; status?: string; result?: string; to?: string } | null;
    if (!b?.id || !b?.status) return fail(c, 400, "id 和 status 必填");
    if (!VALID_STATUS.has(b.status)) return fail(c, 400, "status 必须是 queued|running|done|failed");
    const d = getDb();
    const now = nowIso();
    const finished = b.status === "done" || b.status === "failed" ? now : null;
    const info = d.prepare(
      `UPDATE dispatch_tasks SET status=?, result=COALESCE(?, result), updated_at=?, finished_at=COALESCE(?, finished_at) WHERE id=?`,
    ).run(b.status, b.result ?? null, now, finished, b.id);
    if (info.changes === 0) return fail(c, 404, `任务不存在: ${b.id}`);
    return ok(c, { id: b.id, status: b.status });
  });

  // list —— 按 agentId 查看队列
  api.get("/dispatch/list", (c) => {
    const to = c.req.query("to")?.trim();
    if (!to) return fail(c, 400, "to 必填");
    const status = c.req.query("status")?.trim() || "";
    const limit = Math.min(Math.max(parseInt(c.req.query("limit") || "50", 10) || 50, 1), 200);
    const d = getDb();
    let rows: DispatchTask[];
    if (status && VALID_STATUS.has(status)) {
      rows = d.prepare(
        `SELECT * FROM dispatch_tasks WHERE to_agent = ? AND status = ? ORDER BY updated_at DESC LIMIT ?`,
      ).all(to, status, limit) as unknown as DispatchTask[];
    } else {
      rows = d.prepare(
        `SELECT * FROM dispatch_tasks WHERE to_agent = ? ORDER BY updated_at DESC LIMIT ?`,
      ).all(to, limit) as unknown as DispatchTask[];
    }
    return ok(c, { tasks: rows, total: rows.length });
  });

  // stats —— 各队列概览
  api.get("/dispatch/stats", (c) => {
    const d = getDb();
    const rows = d.prepare(
      `SELECT to_agent,
              SUM(CASE WHEN status='queued' THEN 1 ELSE 0 END) AS queued,
              SUM(CASE WHEN status='running' THEN 1 ELSE 0 END) AS running,
              SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) AS done,
              SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed
       FROM dispatch_tasks GROUP BY to_agent ORDER BY to_agent`,
    ).all() as Array<{ to_agent: string; queued: number; running: number; done: number; failed: number }>;
    return ok(c, { queues: rows });
  });
}
