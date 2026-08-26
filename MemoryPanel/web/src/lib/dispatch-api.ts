/**
 * 任务派送（Dispatch）API 客户端
 *
 * 前缀：/api/v1/dispatch，统一信封 { code, message, request_id, data }
 * 鉴权与 meta API 一致：X-Tdai-Service-Id + X-Tdai-User-Key
 */
import { getPanelSession } from './panelSession';

const BASE = '/api/v1/dispatch';

interface Envelope<T = any> {
  code: number;
  message: string;
  request_id: string;
  data: T;
}

export interface DispatchTask {
  id: string;
  team_id: string;
  from_agent: string;
  to_agent: string;
  type: string;
  payload: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  result?: string | null;
  created_at: string;
  updated_at: string;
  claimed_at?: string | null;
  finished_at?: string | null;
}

export class DispatchApiError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.name = 'DispatchApiError';
    this.code = code;
  }
}

async function request<T>(path: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
  const session = getPanelSession();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (session) {
    headers['X-Tdai-Service-Id'] = session.instanceId;
    headers['X-Tdai-User-Key'] = session.userKey;
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let env: Envelope<T>;
  try {
    env = JSON.parse(text) as Envelope<T>;
  } catch {
    throw new DispatchApiError(res.status, `HTTP ${res.status}`);
  }
  if (env.code !== 0) throw new DispatchApiError(env.code, env.message || String(env.code));
  return env.data;
}

export const dispatchApi = {
  send: (body: { from: string; to: string; type: string; payload: string; team_id?: string }) =>
    request<{ id: string; status: string }>('/send', 'POST', body),
  claim: (to: string) => request<{ task: DispatchTask | null }>('/claim', 'POST', { to }),
  update: (body: { id: string; to: string; status: string; result?: string }) =>
    request<{ id: string; status: string }>('/update', 'POST', body),
  list: (to: string, status?: string, limit?: number) => {
    const qs = new URLSearchParams({ to });
    if (status) qs.set('status', status);
    if (limit) qs.set('limit', String(limit));
    return request<{ tasks: DispatchTask[]; total: number }>(`/list?${qs}`, 'GET');
  },
  stats: () =>
    request<{ queues: Array<{ to_agent: string; queued: number; running: number; done: number; failed: number }> }>(
      '/stats',
      'GET',
    ),
};
