/**
 * TAM (Tencent Agent Memory) extension for pi coding agent
 *
 * 把 UG 上的 TAM 记忆库接进 pi：模型可通过工具语义召回历史记忆、
 * 沉淀重要结论。跨项目/跨设备的长期记忆，与本地 session 互补。
 *
 * 安装：复制到 ~/.pi/agent/extensions/tam.ts 或项目 .pi/extensions/tam.ts
 * 依赖：Termux 需 pkg install curl（已预装一般）
 *
 * 配置（环境变量，放 ~/.pi/agent/.env 或 shell profile）：
 *   TAM_URL   TAM 入口。公网手机: https://tam.duanz.xin:1218
 *             内网时:     http://192.168.5.242:8430
 *   TAM_KEY   代理鉴权 token（与 UG /opt/tencent-mem/pi-proxy.env 的 TAM_PI_TOKEN 一致）
 *
 * 工具：
 *   tam_recall  — 语义召回（query, limit?, session_id?）
 *   tam_save    — 沉淀记忆（content, session_id?, topic?）
 *
 * 传输用 curl -sk：TAM 公网入口是自签证书（caddy tls internal），
 * fetch 会拒证；curl -k 忽略证书校验，配 X-Tam-Key 鉴权足够安全。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

const DEFAULT_URL = "https://tam.duanz.xin:1218";
const URL = process.env.TAM_URL || DEFAULT_URL;
const KEY = process.env.TAM_KEY || "";

function sessionId(override?: string): string {
	if (override && override.trim()) return override.trim();
	const cwd = process.cwd() || "unknown";
	const base = cwd.split("/").filter(Boolean).pop() || "root";
	return `pi-${base}`;
}

async function tamPost(path: string, body: unknown): Promise<string> {
	if (!KEY) {
		return "ERROR: TAM_KEY 未配置。请在 ~/.pi/agent/.env 里设置 TAM_KEY（与 UG tam-pi-proxy 的 token 一致）。";
	}
	try {
		const { stdout, stderr } = await execFileP(
			"curl",
			[
				"-sk", "-m", "40",
				"-X", "POST",
				"-H", "Content-Type: application/json",
				"-H", `X-Tam-Key: ${KEY}`,
				"-d", JSON.stringify(body),
				`${URL}${path}`,
			],
			{ maxBuffer: 4 * 1024 * 1024 },
		);
		return stdout || `(empty output${stderr ? `, stderr: ${stderr.slice(0, 200)}` : ""})`;
	} catch (e: unknown) {
		const err = e as { code?: string; stderr?: string; message?: string };
		if (err?.code === "ENOENT") {
			return "ERROR: 找不到 curl 命令。请在 Termux 里运行: pkg install curl";
		}
		return `ERROR: TAM 请求失败 (${err?.code ?? "?"}): ${(err?.stderr || err?.message || "").slice(0, 250)}`;
	}
}

export default function tamExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "tam_recall",
		label: "TAM Recall",
		description:
			"从 TAM 长期记忆库语义召回历史对话/结论/知识（跨项目跨设备）。" +
			"适用于用户问'之前我们讨论过…'、需要历史上下文、或要复用过去的决策时。",
		promptSnippet: "需要历史记忆/上下文时调用 tam_recall 查询 TAM 记忆库",
		promptGuidelines: [
			"用户提到之前的对话、结论、决策、偏好时，先 tam_recall 再回答",
			"不要凭空编造历史，查不到就明说没查到",
		],
		parameters: Type.Object({
			query: Type.String({ description: "搜索关键词/问题，尽量具体" }),
			limit: Type.Optional(Type.Number({ description: "返回条数，默认 5" })),
			session_id: Type.Optional(
				Type.String({
					description: "限定某会话范围检索（可选，默认全局搜索）",
				}),
			),
		}),
		async execute(_toolCallId, params) {
			const body: Record<string, unknown> = {
				query: params.query,
				limit: params.limit ?? 5,
			};
			if (params.session_id) body.session_id = params.session_id;
			const raw = await tamPost("/v3/conversation/search", body);
			try {
				const d = JSON.parse(raw);
				const msgs = d?.data?.messages;
				if (!Array.isArray(msgs) || msgs.length === 0) return { content: [{ type: "text", text: "(无命中)" }] };
				const lines = msgs.map((m) => {
					const sc = typeof m.score === "number" ? `[${m.score.toFixed(2)}]` : "";
					return `${sc} ${(m.timestamp || "").slice(0, 16)} | ${String(m.content || "").slice(0, 400)}`;
				});
				return { content: [{ type: "text", text: lines.join("\n") }] };
			} catch {
				return { content: [{ type: "text", text: `解析失败，原始返回:\n${raw.slice(0, 500)}` }] };
			}
		},
	});

	pi.registerTool({
		name: "tam_save",
		label: "TAM Save",
		description:
			"把重要结论/决策/用户偏好/项目约定沉淀到 TAM 长期记忆库，供未来跨会话召回。" +
			"适合任务完成时的关键结论、用户明确表达的偏好、值得跨项目复用的知识。不要保存临时性的琐碎内容，不要保存密钥/口令。",
		promptSnippet: "会话产生重要结论或用户偏好时，用 tam_save 沉淀到长期记忆",
		promptGuidelines: [
			"完成任务、得出关键结论时主动 tam_save，内容写成自包含的一句话总结",
			"避免保存密钥/口令/敏感凭据",
		],
		parameters: Type.Object({
			content: Type.String({ description: "要沉淀的记忆内容，自包含、可检索" }),
			session_id: Type.Optional(
				Type.String({
					description: "会话标识（可选，默认 pi-<项目目录名>）",
				}),
			),
			topic: Type.Optional(Type.String({ description: "主题标签，写入内容前缀，方便检索（可选）" })),
		}),
		async execute(_toolCallId, params) {
			const sid = sessionId(params.session_id);
			const text = params.topic ? `[${params.topic}] ${params.content}` : params.content;
			const raw = await tamPost("/v3/conversation/add", {
				session_id: sid,
				messages: [{ role: "user", content: text }],
			});
			try {
				const d = JSON.parse(raw);
				if (d?.code === 0) return { content: [{ type: "text", text: `已保存到 TAM（session: ${sid}）` }] };
				return { content: [{ type: "text", text: `TAM 返回: ${raw.slice(0, 300)}` }] };
			} catch {
				return { content: [{ type: "text", text: `原始返回: ${raw.slice(0, 300)}` }] };
			}
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		ctx.ui.notify(`TAM extension loaded (${URL})`, "info");
	});
}