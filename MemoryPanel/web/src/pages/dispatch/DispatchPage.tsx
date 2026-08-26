/**
 * Agent 管理中心（原「任务派送」页重构）
 *
 * 定位：
 *   1. 汇总展示每个注册 Agent 的知识文件（Wiki）、Skill、CodeGraph、Chat Memory
 *      资产数量 + 任务派送队列概况 —— 数据来自 agent-overview/bootstrap 与 dispatch/stats
 *   2. 只读的任务状态视图：任务的发起与结算都由 Agent 侧通过
 *      POST /api/v1/dispatch/send|claim|update 完成，本页仅做状态可视化
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Select, Table, Layout } from 'tea-component';
import { useTeams, useAgents } from '@/stores/backend';
import { loadAgentOverview } from '@/components/team/useAgentAssets';
import type { AgentMountedCounts } from '@/components/team/types';
import { dispatchApi, type DispatchTask } from '@/lib/dispatch-api';

const { Content } = Layout;

interface AgentRow {
  agentId: string;
  name: string;
  description: string;
  counts?: AgentMountedCounts;
  queue?: { queued: number; running: number; done: number; failed: number };
}

const STATUS_LABEL: Record<string, { text: string; color: string }> = {
  queued: { text: '待认领', color: '#666' },
  running: { text: '执行中', color: '#b8860b' },
  done: { text: '已完成', color: '#0a7d43' },
  failed: { text: '已失败', color: '#c9302c' },
};

export function DispatchPage() {
  const { t } = useTranslation();
  const { activeTeamId, activeTeam } = useTeams();
  const { agents } = useAgents(activeTeamId);

  const [rows, setRows] = useState<AgentRow[]>([]);
  const [viewAgent, setViewAgent] = useState<string>('');
  const [tasks, setTasks] = useState<DispatchTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);

  // 资产统计 + 队列概况
  const loadOverview = useCallback(async () => {
    if (!activeTeamId || agents.length === 0) {
      setRows([]);
      return;
    }
    const agentIds = agents.map((a) => a.agent_id);
      const [overview, statsRes] = await Promise.all([
        loadAgentOverview(activeTeamId, agentIds).catch(() => null),
        dispatchApi.stats().catch(() => null),
      ]);
      const queueMap = new Map(
        (statsRes?.queues ?? []).map((q) => [
          q.to_agent,
          { queued: q.queued, running: q.running, done: q.done, failed: q.failed },
        ]),
      );
      setRows(
        agents.map((a) => ({
          agentId: a.agent_id,
          name: a.name,
          description: a.description ?? '',
          counts: overview?.counts?.[a.agent_id],
          queue: queueMap.get(a.name),
        })),
      );
  }, [activeTeamId, agents]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  // 只读任务列表：按 agent 名查看发起/结算状态
  const loadTasks = useCallback(async (agentName: string) => {
    if (!agentName.trim()) {
      setTasks([]);
      return;
    }
    setTasksLoading(true);
    try {
      const res = await dispatchApi.list(agentName.trim());
      setTasks(res.tasks);
    } catch {
      setTasks([]);
    } finally {
      setTasksLoading(false);
    }
  }, []);

  useEffect(() => {
    if (viewAgent) void loadTasks(viewAgent);
  }, [viewAgent, loadTasks]);

  // 派送地址候选 = 注册 Agent 的名字 ∪ 队列里出现过的名字
  const addressOptions = useMemo(() => {
    const names = new Set<string>(agents.map((a) => a.name));
    if (viewAgent) names.add(viewAgent);
    return [...names];
  }, [agents, viewAgent]);

  return (
    <Content className="dispatch-page">
      <Content.Header title={t('dispatch.title')} />
      <Content.Body>
        {/* ── Agent 资产总览 ── */}
        <div style={{ fontSize: 14, fontWeight: 600, margin: '4px 0 12px' }}>
          {t('dispatch.agentAssets')} · {activeTeam?.name ?? ''}
        </div>
        {rows.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#999', fontSize: 13 }}>
            {t('dispatch.noAgents')}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
            {rows.map((r) => (
              <div key={r.agentId} style={{ border: '1px solid #e0e0e0', borderRadius: 6, padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontSize: 15, fontWeight: 600 }}>{r.name}</span>
                  <span style={{ fontSize: 11, color: '#999', fontFamily: 'monospace' }}>{r.agentId}</span>
                </div>
                {r.description && (
                  <div style={{ fontSize: 12, color: '#888', margin: '6px 0', lineHeight: 1.5, minHeight: 18 }}>
                    {r.description}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 14, margin: '10px 0', flexWrap: 'wrap' }}>
                  <AssetStat label={t('dispatch.assetWiki')} n={r.counts?.llm_wiki} />
                  <AssetStat label={t('dispatch.assetMemory')} n={r.counts?.chat_memory} />
                  <AssetStat label={t('dispatch.assetSkills')} n={r.counts?.skills} />
                  <AssetStat label={t('dispatch.assetCode')} n={r.counts?.code_graph} />
                </div>
                <div style={{ borderTop: '1px dashed #e8e8e8', paddingTop: 8, fontSize: 12, color: '#666' }}>
                  {r.queue ? (
                    <>
                      {t('dispatch.queueLabel')}：
                      <b style={{ color: '#333' }}>{r.queue.queued}</b> {t('dispatch.queued')} /{' '}
                      <b style={{ color: '#b8860b' }}>{r.queue.running}</b> {t('dispatch.running')} /{' '}
                      <b style={{ color: '#0a7d43' }}>{r.queue.done}</b> {t('dispatch.done')} /{' '}
                      <b style={{ color: '#c9302c' }}>{r.queue.failed}</b> {t('dispatch.failed')}
                    </>
                  ) : (
                    <span style={{ color: '#bbb' }}>{t('dispatch.noQueue')}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── 任务状态（只读） ── */}
        <div style={{ fontSize: 14, fontWeight: 600, margin: '28px 0 12px' }}>
          {t('dispatch.taskStatus')}
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#888' }}>agentId</span>
          <Select
            value={viewAgent || '__pick'}
            onChange={(v) => setViewAgent(v === '__pick' ? '' : v)}
            style={{ width: 200 }}
            options={[
              { value: '__pick', text: t('dispatch.pickAgent') },
              ...addressOptions.map((n) => ({ value: n, text: n })),
            ]}
          />
          <Button onClick={() => viewAgent && loadTasks(viewAgent)} disabled={!viewAgent}>
            {t('dispatch.refresh')}
          </Button>
        </div>

        {tasksLoading ? (
          <div style={{ padding: 16, color: '#999', fontSize: 13 }}>...</div>
        ) : tasks.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: '#999', fontSize: 13, border: '1px solid #eee', borderRadius: 6 }}>
            {viewAgent ? t('dispatch.empty') : t('dispatch.pickAgentHint')}
          </div>
        ) : (
          <Table
            records={tasks}
            recordKey="id"
            columns={[
              { key: 'type', header: t('dispatch.colType'), width: 140 },
              {
                key: 'payload',
                header: t('dispatch.colPayload'),
                render: (task: DispatchTask) => (
                  <span title={task.payload} style={{ display: 'inline-block', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {String(task.payload).slice(0, 90)}
                  </span>
                ),
              },
              {
                key: 'from_agent',
                header: t('dispatch.colFlow'),
                width: 180,
                render: (task: DispatchTask) => `${task.from_agent} → ${task.to_agent}`,
              },
              {
                key: 'result',
                header: t('dispatch.colResult'),
                render: (task: DispatchTask) =>
                  task.result ? (
                    <span title={task.result} style={{ display: 'inline-block', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {String(task.result).slice(0, 70)}
                    </span>
                  ) : (
                    '-'
                  ),
              },
              {
                key: 'status',
                header: t('dispatch.colStatus'),
                width: 100,
                render: (task: DispatchTask) => {
                  const s = STATUS_LABEL[task.status] ?? { text: task.status, color: '#666' };
                  return (
                    <span style={{ fontSize: 11, padding: '1px 8px', borderRadius: 3, border: '1px solid #ddd', color: s.color }}>
                      {s.text}
                    </span>
                  );
                },
              },
              {
                key: 'updated_at',
                header: t('dispatch.colUpdated'),
                width: 160,
                render: (task: DispatchTask) => (
                  <span style={{ color: '#999', fontSize: 11 }}>{String(task.updated_at).replace('T', ' ').slice(0, 19)}</span>
                ),
              },
            ]}
          />
        )}

        <div style={{ marginTop: 16, fontSize: 12, color: '#aaa' }}>{t('dispatch.apiHint')}</div>
      </Content.Body>
    </Content>
  );
}

function AssetStat({ label, n }: { label: string; n?: number }) {
  return (
    <span style={{ fontSize: 12, color: '#666' }}>
      {label} <b style={{ fontSize: 14, color: '#2d3142' }}>{n ?? 0}</b>
    </span>
  );
}
