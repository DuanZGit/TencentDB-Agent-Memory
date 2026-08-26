/**
 * TAM (Tencent Agent Memory) extension for pi coding agent
 *
 * 接 UG 的 TAM agent gateway —— 一个入口同时干两件事：
 *   1) 记忆读写：tam_recall / tam_save（跨会话长期记忆，与 Minis/dsh 共享）
 *   2) 任务队列：tam_task_inbox / tam_task_claim / tam_task_update / tam_task_send
 *      （与其他 agent 互控：收 Minis 派的任务，认领做完回写；也能派给别人）
 *
 * 安装：复制到 ~/.pi/agent/extensions/tam.ts 或项目 .pi/extensions/tam.ts
 * 依赖：Termux 需 curl（-sk 处理 caddy 自签证书）
 *
 * 配置（~/.bashrc 或 ~/.pi/agent/.env）：
 *   TAM_URL       http(s)://tam.duanz.xin:1218  （内网可用 http://192.168.5.242:8430）
 *   TAM_KEY       网关鉴权 token
 *   TAM_AGENT_ID  本 agent 标识，默认 "pi"（任务队列按它收发）
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

const URL = process.env.TAM_URL || "https://tam.duanz.xin:1218";
const KEY = process.env.TAM_KEY || "";
const AGENT_ID = process.env.TAM_AGENT_ID || "pi";

function sessionId(override?: string): string {
	if (override && override.trim()) return override.trim();
	const cwd = process.cwd() || "unknown";
	const base = cwd.split("/").filter(Boolean).pop() || "root";
	return `pi-${base}`;
}

async function tamReq(method: "GET" | "POST", path: string, body?: unknown): Promise<string> {
	if (!KEY) {
		return "ERROR: TAM_KEY 未配置。请在 ~/.bashrc 设置 TAM_KEY（与 UG pi-proxy.env 的 token 一致）。";
	}
	const args = ["-sk", "-m", "40", "-X", method, "-H", `X-Tam-Key: ${KEY}`];
	if (body !== undefined) {
		args.push("-H", "Content-Type: application/json", "-d", JSON.stringify(body));
	}
	args.push(`${URL}${path}`);
	try {
		const { stdout, stderr } = await execFileP("curl", args, { maxBuffer: 4 * 1024 * 1024 });
		return stdout || `(empty output${stderr ? `, stderr: ${stderr.slice(0, 200)}` : ""})`;
	} catch (e: unknown) {
		const err = e as { code?: string; stderr?: string; message?: string };
		if (err?.code === "ENOENT") return "ERROR: 找不到 curl，请先 pkg install curl";
		return `ERROR: TAM 请求失败 (${err?.code ?? "?"}): ${(err?.stderr || err?.message || "").slice(0, 250)}`;
	}
}

/** 解析 envelope，返回 data 或错误字符串。 */
function unwrap(raw: string): unknown {
	try {
		const d = JSON.parse(raw);
		if (d?.code !== 0) return `TAM 返回错误: ${raw.slice(0, 300)}`;
		return d.data;
	} catch {
		return `解析失败，原始返回: ${raw.slice(0, 300)}`;
	}
}

export default function tamExtension(pi: ExtensionAPI) {
	// ── 记忆 ├───────────────────────────────────────────
	pi.registerTool({
		name: "tam_recall",
		label: "TAM Recall",
		description:
			"从 TAM 长期记忆库语义召回历史对话/结论/知识（跨项目跨设备共享）。" +
			"用户问'之前我们讨论过…'、需要历史上下文、复用过去决策时用。",
		promptSnippet: "需要历史记忆/上下文时调用 tam_recall 查询 TAM 记忆库",
		promptGuidelines: [
			"用户提到之前的对话、结论、决策、偏好时，先 tam_recall 再回答",
			"不要凭空编造历史，查不到就明说没查到",
		],
		parameters: Type.Object({
			query: Type.String({ description: "搜索关键词/问题，尽量具体" }),
			limit: Type.Optional(Type.Number({ description: "返回条数，默认 5" })),
			session_id: Type.Optional(Type.String({ description: "限定某会话范围（可选，默认全局搜索）" })),
		}),
		async execute(_toolCallId, params) {
			const body: Record<string, unknown> = { query: params.query, limit: params.limit ?? 5 };
			if (params.session_id) body.session_id = params.session_id;
			const raw = await tamReq("POST", "/v3/conversation/search", body);
			const d = unwrap(raw);
			if (typeof d === "string") return { content: [{ type: "text", text: d }] };
			const msgs = (d as { messages?: unknown[] })?.messages;
			if (!Array.isArray(msgs) || msgs.length === 0) return { content: [{ type: "text", text: "(无命中)" }] };
			const lines = msgs.map((m) => {
				const mm = m as { score?: number; timestamp?: string; content?: string };
				const sc = typeof mm.score === "number" ? `[${mm.score.toFixed(2)}]` : "";
				return `${sc} ${(mm.timestamp || "").slice(0, 16)} | ${String(mm.content || "").slice(0, 400)}`;
			});
			return { content: [{ type: "text", text: lines.join("\n") }] };
		},
	});

	pi.registerTool({
		name: "tam_save",
		label: "TAM Save",
		description:
			"把重要结论/决策/用户偏好/项目约定沉淀到 TAM 长期记忆库，供未来跨会话召回。" +
			"适合任务完成时的关键结论、用户明确表达的偏好。不要保存临时琐碎内容，不要保存密钥/口令。",
		promptSnippet: "会话产生重要结论或用户偏好时，用 tam_save 沉淀到长期记忆",
		promptGuidelines: [
			"完成任务、得出关键结论时主动 tam_save，内容写成自包含的一句话总结",
			"避免保存密钥/口令/敏感凭据",
		],
		parameters: Type.Object({
			content: Type.String({ description: "要沉淀的记忆内容，自包含、可检索" }),
			session_id: Type.Optional(Type.String({ description: "会话标识（可选，默认 pi-<项目目录名>）" })),
			topic: Type.Optional(Type.String({ description: "主题标签，写入内容前缀（可选）" })),
		}),
		async execute(_toolCallId, params) {
			const sid = sessionId(params.session_id);
			const text = params.topic ? `[${params.topic}] ${params.content}` : params.content;
			const raw = await tamReq("POST", "/v3/conversation/add", {
				session_id: sid,
				messages: [{ role: "user", content: text }],
			});
			const d = unwrap(raw);
			if (typeof d === "string") return { content: [{ type: "text", text: d }] };
			return { content: [{ type: "text", text: `已保存到 TAM（session: ${sid}）` }] };
		},
	});

	// ── 任务队列 ──────────────────────────────────────────
	pi.registerTool({
		name: "tam_task_inbox",
		label: "TAM Task Inbox",
		description:
			"查看本 agent 的任务收件箱（他人/系统派给我的排队任务）。任务队列与记忆库同源，" +
			"Minis / dsh / 其他 agent 派给我的活都在这里。",
		promptSnippet: "看看有没有派给我的任务时，用 tam_task_inbox",
		promptGuidelines: ["回复用户'有没有任务'时先 tam_task_inbox，不要凭空说没有"],
		parameters: Type.Object({
			status: Type.Optional(
				Type.String({ description: "按状态过滤：queued|running|done|failed，默认 queued" }),
			),
			limit: Type.Optional(Type.Number({ description: "返回条数，默认 10" })),
		}),
		async execute(_toolCallId, params) {
			const q = `to=${encodeURIComponent(AGENT_ID)}&status=${encodeURIComponent(params.status ?? "queued")}&limit=${params.limit ?? 10}`;
			const raw = await tamReq("GET", `/api/v1/dispatch/list?${q}`);
			const d = unwrap(raw);
			if (typeof d === "string") return { content: [{ type: "text", text: d }] };
			const items = (d as { tasks?: unknown[] })?.tasks;
			if (!Array.isArray(items) || items.length === 0)
				return { content: [{ type: "text", text: `(收件箱空，agent=${AGENT_ID})` }] };
			const lines = items.map((it) => {
				const t = it as { id?: string; type?: string; payload?: string; created_at?: string };
				return `[${t.id}] ${t.type}: ${String(t.payload || "").slice(0, 200)} (${t.created_at || ""})`;
			});
			return { content: [{ type: "text", text: `agent=${AGENT_ID} 收件箱 ${items.length} 条:\n${lines.join("\n")}` }] };
		},
	});

	pi.registerTool({
		name: "tam_task_claim",
		label: "TAM Task Claim",
		description:
			"认领收件箱里的一个排队任务（原子认领，别人抢不走）。认领后尽快执行并把结果用 tam_task_update 回写。" +
			"完成后应把关键结论同时用 tam_save 沉淀到记忆库。",
		promptSnippet: "收到任务并准备执行时，用 tam_task_claim 认领",
		promptGuidelines: ["认领的任务执行完必须 tam_task_update 回写结果，否则会一直卡在 running"],
		parameters: Type.Object({}),
		async execute() {
			const raw = await tamReq("POST", "/api/v1/dispatch/claim", { to: AGENT_ID });
			const d = unwrap(raw);
			if (typeof d === "string") return { content: [{ type: "text", text: d }] };
			const task = d as { id?: string; type?: string; payload?: string; from_agent?: string } | null;
			if (!task || !task.id) return { content: [{ type: "text", text: "(没有可认领的任务)" }] };
			return {
				content: [
					{
						type: "text",
						text: `已认领任务 ${task.id}\n类型: ${task.type}\n来源: ${task.from_agent}\n任务内容: ${String(task.payload || "").slice(0, 500)}`,
					},
				],
			};
		},
	});

	pi.registerTool({
		name: "tam_task_update",
		label: "TAM Task Update",
		description:
			"回写任务结果（认领过的任务必须回写）。status 填 done 或 failed，result 写执行结果/结论。",
		promptSnippet: "任务执行完用 tam_task_update 回写结果",
		promptGuidelines: ["回写成功后任务才会从队列消失，一定要做"],
		parameters: Type.Object({
			task_id: Type.String({ description: "认领时返回的任务 id" }),
			status: Type.String({ description: "done 或 failed" }),
			result: Type.String({ description: "执行结果/结论" }),
		}),
		async execute(_toolCallId, params) {
			const raw = await tamReq("POST", "/api/v1/dispatch/update", {
				id: params.task_id,
				status: params.status,
				result: params.result,
				to: AGENT_ID,
			});
			const d = unwrap(raw);
			if (typeof d === "string") return { content: [{ type: "text", text: d }] };
			return { content: [{ type: "text", text: `任务 ${params.task_id} 已标记为 ${params.status}` }] };
		},
	});

	pi.registerTool({
		name: "tam_task_send",
		label: "TAM Task Send",
		description:
			"给其他 agent 派任务（如 dsh）。对方认领执行后会回写结果。from 自动用本 agent 标识。",
		promptSnippet: "需要把活派给其他 agent（如 dsh/Claude Code）时用 tam_task_send",
		promptGuidelines: ["派任务时 type 写清任务类别，payload 写清要对方做的事"],
		parameters: Type.Object({
			to: Type.String({ description: "目标 agent 标识，如 dsh / minis / claude-code" }),
			type: Type.String({ description: "任务类型，如 research / coding / recall" }),
			payload: Type.String({ description: "任务内容描述，尽量具体" }),
			team_id: Type.Optional(Type.String({ description: "团队标识（可选）" })),
		}),
		async execute(_toolCallId, params) {
			const body: Record<string, unknown> = {
				from: AGENT_ID,
				to: params.to,
				type: params.type,
				payload: params.payload,
			};
			if (params.team_id) body.team_id = params.team_id;
			const raw = await tamReq("POST", "/api/v1/dispatch/send", body);
			const d = unwrap(raw);
			if (typeof d === "string") return { content: [{ type: "text", text: d }] };
			const r = d as { id?: string };
			return { content: [{ type: "text", text: `已派发任务 ${r.id} -> ${params.to}` }] };
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		ctx.ui.notify(`TAM gateway loaded (${URL}, agent=${AGENT_ID})`, "info");
	});
}