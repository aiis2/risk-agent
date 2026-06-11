/**
 * SecurityTab — 沙盒与安全设置标签页（模块10 §2/§5/§7）
 *
 * 展示：
 * 1. JS 沙盒配置（超时、禁止模式列表）
 * 2. Sub-Agent 安全配置（权限层级）
 * 3. 安全审计事件日志
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  IconShield,
  IconAlertTriangle,
  IconBug,
  IconClock,
  IconLock,
  IconRefresh,
  IconDatabase,
  IconBolt,
  IconCircleCheck,
  IconCircleX,
  IconFilter,
  IconCode,
  IconPencil,
  IconDeviceFloppy,
  IconX,
  IconTerminal2,
  IconNetwork,
  IconFolder,
} from '@tabler/icons-react';
import { clsx } from 'clsx';
import { getSecurityAudit, getSecurityConfig, putSubAgentConfig, type SecurityConfig, type SecurityEventType } from '../../../api/client';
import { ScrollArea } from '../../ui/ScrollArea';
import { Select, SelectItem } from '../../ui/Select';
import { buildSandboxAuditDetailLines } from '../../../lib/sandboxDisplay';

// ─── 事件类型配置 ─────────────────────────────────────────────────────────────

const EVENT_TYPE_CONFIG: Record<
  SecurityEventType,
  {
    label: string;
    textCls: string;
    bgBorderCls: string;
    Icon: React.ComponentType<{ size?: number | string; className?: string }>;
  }
> = {
  'sandbox-code-blocked':        { label: '代码拦截', textCls: 'text-danger', bgBorderCls: 'bg-danger/10 border-danger/25', Icon: IconCode },
  'sandbox-timeout':             { label: '执行超时', textCls: 'text-warn', bgBorderCls: 'bg-warn/10 border-warn/25', Icon: IconClock },
  'sandbox-error':               { label: '执行异常', textCls: 'text-warn', bgBorderCls: 'bg-warn/10 border-warn/25', Icon: IconBug },
  'sandbox-lease-created':       { label: '租约创建', textCls: 'text-accent', bgBorderCls: 'bg-accent/10 border-accent/25', Icon: IconBolt },
  'sandbox-lease-complete':      { label: '租约完成', textCls: 'text-success', bgBorderCls: 'bg-success/10 border-success/25', Icon: IconCircleCheck },
  'sandbox-lease-cancelled':     { label: '租约取消', textCls: 'text-danger', bgBorderCls: 'bg-danger/10 border-danger/25', Icon: IconCircleX },
  'sandbox-process-started':     { label: '进程启动', textCls: 'text-accent', bgBorderCls: 'bg-accent/10 border-accent/25', Icon: IconBolt },
  'sandbox-process-complete':    { label: '进程完成', textCls: 'text-success', bgBorderCls: 'bg-success/10 border-success/25', Icon: IconCircleCheck },
  'sandbox-process-cancelled':   { label: '进程取消', textCls: 'text-danger', bgBorderCls: 'bg-danger/10 border-danger/25', Icon: IconCircleX },
  'sql-blocked':                 { label: 'SQL 拒绝', textCls: 'text-danger', bgBorderCls: 'bg-danger/10 border-danger/25', Icon: IconDatabase },
  'permission-denied':           { label: '权限拒绝', textCls: 'text-danger', bgBorderCls: 'bg-danger/10 border-danger/25', Icon: IconLock },
  'subagent-capability-blocked': { label: '能力拦截', textCls: 'text-warn', bgBorderCls: 'bg-warn/10 border-warn/25', Icon: IconShield },
  'parameter-injection':         { label: '参数注入', textCls: 'text-danger', bgBorderCls: 'bg-danger/10 border-danger/25', Icon: IconAlertTriangle },
};

const EVENT_TYPE_OPTIONS: { value: SecurityEventType | 'all'; label: string }[] = [
  { value: 'all', label: '全部类型' },
  ...Object.entries(EVENT_TYPE_CONFIG).map(([k, v]) => ({
    value: k as SecurityEventType,
    label: v.label,
  })),
];

// ─── 时间格式化 ──────────────────────────────────────────────────────────────

function fmtTs(ts: number): string {
  const d = new Date(ts);
  return `${d.toLocaleDateString('zh-CN')} ${d.toLocaleTimeString('zh-CN', { hour12: false })}`;
}

function fmtMs(ms: number): string {
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}min`;
  if (ms >= 1_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${ms}ms`;
}

type SecuritySandboxConfig = SecurityConfig['sandbox'];
type CapabilityTone = 'blocked' | 'enabled' | 'notice';

function CapabilityRow({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
  label: string;
  value: string;
  hint: string;
  tone: CapabilityTone;
}) {
  const toneClass = tone === 'enabled'
    ? 'border-success/25 bg-success/10 text-success'
    : tone === 'blocked'
      ? 'border-danger/25 bg-danger/10 text-danger'
      : 'border-warn/25 bg-warn/10 text-warn';

  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-md border border-border bg-surface-input p-1.5 text-text-subtle">
          <Icon size={13} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-text">{label}</div>
            <span className={clsx('shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium', toneClass)}>
              {value}
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-4 text-text-subtle">{hint}</p>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-Agent 安全配置面板（可编辑）────────────────────────────────────────

const inputNumCls = 'w-full h-8 bg-surface border border-border rounded-lg px-3 text-sm text-text placeholder-text-muted focus:outline-none focus:border-accent/50 transition-colors';
const labelCls = 'text-xs text-text-muted mb-1 block';

function SubAgentConfigPanel({ sa }: { sa: { maxSteps: number; compactThresholdTokens: number; toolExecutionTimeoutMs: number; totalTimeoutMs: number; forbiddenCapabilities: string[]; allowedToolNames: string[] } | undefined }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [maxSteps, setMaxSteps] = useState('');
  const [compactTokens, setCompactTokens] = useState('');
  const [toolTimeoutMs, setToolTimeoutMs] = useState('');
  const [totalTimeoutMs, setTotalTimeoutMs] = useState('');
  const [forbiddenCaps, setForbiddenCaps] = useState('');
  const [allowedTools, setAllowedTools] = useState('');

  function startEdit() {
    if (!sa) return;
    setMaxSteps(String(sa.maxSteps));
    setCompactTokens(String(sa.compactThresholdTokens));
    setToolTimeoutMs(String(sa.toolExecutionTimeoutMs));
    setTotalTimeoutMs(String(sa.totalTimeoutMs));
    setForbiddenCaps(sa.forbiddenCapabilities.join(', '));
    setAllowedTools(sa.allowedToolNames.join(', '));
    setEditing(true);
  }

  const saveMut = useMutation({
    mutationFn: () => putSubAgentConfig({
      maxSteps: Number(maxSteps) || undefined,
      compactThresholdTokens: Number(compactTokens) || undefined,
      toolExecutionTimeoutMs: Number(toolTimeoutMs) || undefined,
      totalTimeoutMs: Number(totalTimeoutMs) || undefined,
      forbiddenCapabilities: forbiddenCaps.split(',').map((s) => s.trim()).filter(Boolean),
      allowedToolNames: allowedTools.split(',').map((s) => s.trim()).filter(Boolean),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['security-config'] }); setEditing(false); },
  });

  return (
    <div className="bg-surface-card border border-border-subtle rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <IconShield size={14} className="text-accent" />
        <h3 className="text-sm font-semibold text-text">Sub-Agent 权限收窄</h3>
        <div className="ml-auto flex items-center gap-2">
          {editing ? (
            <>
              <button
                onClick={() => setEditing(false)}
                className="flex items-center gap-1 text-xs text-text-muted hover:text-text transition-colors"
              >
                <IconX size={12} /> 取消
              </button>
              <button
                onClick={() => saveMut.mutate()}
                disabled={saveMut.isPending}
                className="flex items-center gap-1.5 px-3 py-1 bg-accent/15 hover:bg-accent/25 text-accent rounded-lg text-xs font-medium transition-colors"
              >
                <IconDeviceFloppy size={12} />
                {saveMut.isPending ? '保存中…' : '保存'}
              </button>
            </>
          ) : (
            <button
              onClick={startEdit}
              className="flex items-center gap-1 text-xs text-text-muted hover:text-accent transition-colors"
            >
              <IconPencil size={12} /> 编辑
            </button>
          )}
        </div>
      </div>

      {editing ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="subagent-max-steps" className={labelCls}>最大步数</label>
              <input id="subagent-max-steps" aria-label="最大步数" type="number" className={inputNumCls} value={maxSteps} min={1} max={50}
                onChange={(e) => setMaxSteps(e.target.value)} />
            </div>
            <div>
              <label htmlFor="subagent-compact-threshold" className={labelCls}>上下文预算 (tokens)</label>
              <input id="subagent-compact-threshold" aria-label="上下文预算 (tokens)" type="number" className={inputNumCls} value={compactTokens} min={1000}
                onChange={(e) => setCompactTokens(e.target.value)} />
            </div>
            <div>
              <label htmlFor="subagent-tool-timeout" className={labelCls}>工具超时 (ms)</label>
              <input id="subagent-tool-timeout" aria-label="工具超时 (ms)" type="number" className={inputNumCls} value={toolTimeoutMs} min={5000}
                onChange={(e) => setToolTimeoutMs(e.target.value)} />
            </div>
            <div>
              <label htmlFor="subagent-total-timeout" className={labelCls}>总超时 (ms)</label>
              <input id="subagent-total-timeout" aria-label="总超时 (ms)" type="number" className={inputNumCls} value={totalTimeoutMs} min={10000}
                onChange={(e) => setTotalTimeoutMs(e.target.value)} />
            </div>
          </div>
          <div>
            <label className={labelCls}>禁止能力（逗号分隔）</label>
            <input className={inputNumCls} value={forbiddenCaps} placeholder="ask_user, spawn_sub_agent, ..."
              onChange={(e) => setForbiddenCaps(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>允许工具（逗号分隔）</label>
            <input className={inputNumCls} value={allowedTools} placeholder="query_database, web_fetch, ..."
              onChange={(e) => setAllowedTools(e.target.value)} />
          </div>
          {saveMut.isError && (
            <p className="text-xs text-danger">保存失败，请检查输入后重试。</p>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-3 mb-4">
            <div className="bg-surface rounded-lg p-3 border border-border">
              <div className="text-xs text-text-muted mb-1">最大步数</div>
              <div className="text-sm font-semibold text-text">{sa?.maxSteps ?? '—'}</div>
            </div>
            <div className="bg-surface rounded-lg p-3 border border-border">
              <div className="text-xs text-text-muted mb-1">上下文预算</div>
              <div className="text-sm font-semibold text-text">
                {sa ? `${(sa.compactThresholdTokens / 1000).toFixed(0)}K` : '—'}
              </div>
            </div>
            <div className="bg-surface rounded-lg p-3 border border-border">
              <div className="text-xs text-text-muted mb-1">工具超时</div>
              <div className="text-sm font-semibold text-text">
                {sa ? fmtMs(sa.toolExecutionTimeoutMs) : '—'}
              </div>
            </div>
            <div className="bg-surface rounded-lg p-3 border border-border">
              <div className="text-xs text-text-muted mb-1">总超时</div>
              <div className="text-sm font-semibold text-text">
                {sa ? fmtMs(sa.totalTimeoutMs) : '—'}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-xs text-text-muted mb-2">禁止能力</div>
              <div className="flex flex-wrap gap-1.5">
                {(sa?.forbiddenCapabilities ?? []).map((cap) => (
                  <span key={cap} className="flex items-center gap-1 px-2 py-0.5 bg-danger/10 border border-danger/25 rounded text-xs text-danger">
                    <IconCircleX size={10} />{cap}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <div className="text-xs text-text-muted mb-2">允许工具</div>
              <div className="flex flex-wrap gap-1.5">
                {(sa?.allowedToolNames ?? []).map((tool) => (
                  <span key={tool} className="flex items-center gap-1 px-2 py-0.5 bg-success/10 border border-success/25 rounded text-xs text-success">
                    <IconCircleCheck size={10} />{tool}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── 运行时能力面板 ─────────────────────────────────────────────────────────

function JSSandboxRuntimePanel({ sandbox }: { sandbox: SecuritySandboxConfig | undefined }) {
  const runtime = sandbox?.runtime;

  return (
    <div className="rounded-xl border border-border bg-surface-card p-5">
      <div className="mb-2 flex items-center gap-2">
        <IconCode size={14} className="text-accent" />
        <h3 className="text-sm font-semibold text-text">JS 沙盒运行时限制</h3>
        <span className="ml-auto rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] text-text-subtle">
          服务端固定策略
        </span>
      </div>
      <p className="mb-4 text-[11px] leading-4 text-text-subtle">
        当前 JS 沙盒使用固定的 {runtime?.hostKind ?? 'js-vm'} 主机配置。用户级覆盖尚未接入运行时，原先的本地开关不会真正改变执行结果，现已改为只读状态展示。
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <CapabilityRow
          icon={IconLock}
          label="动态执行"
          value={runtime?.dynamicEval ? '允许' : '已禁用'}
          hint="eval() 与 Function() 当前由静态安全扫描直接拦截。"
          tone={runtime?.dynamicEval ? 'enabled' : 'blocked'}
        />
        <CapabilityRow
          icon={IconCode}
          label="动态导入"
          value={runtime?.dynamicImports ? '允许' : '已禁用'}
          hint="import 与 import() 当前不会暴露给 JS 沙盒。"
          tone={runtime?.dynamicImports ? 'enabled' : 'blocked'}
        />
        <CapabilityRow
          icon={IconNetwork}
          label="网络请求"
          value={runtime?.httpRequests ? '允许' : '已禁用'}
          hint="fetch、XMLHttpRequest 与域名白名单覆盖当前均未接入 JS 沙盒运行时。"
          tone={runtime?.httpRequests ? 'enabled' : 'blocked'}
        />
        <CapabilityRow
          icon={IconFolder}
          label="文件系统访问"
          value={runtime?.filesystem === 'none' ? '无访问' : '受限'}
          hint="js-vm 主机不向沙盒暴露宿主文件系统能力。"
          tone={runtime?.filesystem === 'none' ? 'blocked' : 'notice'}
        />
        <CapabilityRow
          icon={IconShield}
          label="用户级覆盖"
          value={runtime?.userOverridesSupported ? '支持' : '未实现'}
          hint="如需修改 JS 沙盒策略，需要调整服务端 runtime，而不是浏览器本地设置。"
          tone={runtime?.userOverridesSupported ? 'enabled' : 'notice'}
        />
      </div>
    </div>
  );
}

function LocalProcessPolicyPanel({ sandbox }: { sandbox: SecuritySandboxConfig | undefined }) {
  const localProcess = sandbox?.localProcess;

  return (
    <div className="rounded-xl border border-border bg-surface-card p-5">
      <div className="mb-2 flex items-center gap-2">
        <IconTerminal2 size={14} className="text-accent" />
        <h3 className="text-sm font-semibold text-text">本地进程执行策略</h3>
        <span className="ml-auto rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] text-text-subtle">
          按工具启用
        </span>
      </div>
      <p className="mb-4 text-[11px] leading-4 text-text-subtle">
        本地进程沙盒只会在工具显式绑定 {localProcess?.hostKind ?? 'local-process'} 主机时启用。命令白名单、工作目录、危险确认等用户级终端开关目前都没有接入后端和运行时。
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <CapabilityRow
          icon={IconTerminal2}
          label="主机可用性"
          value={localProcess?.available ? '可用' : '不可用'}
          hint="只有声明 local-process 沙盒能力的工具才会拿到该执行主机。"
          tone={localProcess?.available ? 'enabled' : 'blocked'}
        />
        <CapabilityRow
          icon={IconNetwork}
          label="默认网络策略"
          value={localProcess?.defaultNetwork === 'deny' ? '默认拒绝' : '允许'}
          hint="当前本地进程沙盒默认以 deny 网络策略创建。"
          tone={localProcess?.defaultNetwork === 'deny' ? 'blocked' : 'enabled'}
        />
        <CapabilityRow
          icon={IconFolder}
          label="文件系统范围"
          value={localProcess?.filesystemScopeSource === 'tool-binding' ? '由工具绑定决定' : '固定'}
          hint="实际读写范围取决于工具声明的 sandbox access tier，而不是用户页签中的本地配置。"
          tone="notice"
        />
        <CapabilityRow
          icon={IconClock}
          label="执行超时"
          value={localProcess?.timeoutSource === 'tool-policy' ? '由工具策略决定' : '固定'}
          hint="超时上限来自工具沙盒策略，用户侧毫秒输入框当前不会改变执行超时。"
          tone="notice"
        />
        <CapabilityRow
          icon={IconShield}
          label="命令白名单 / 二次确认"
          value={localProcess?.commandAllowlistSupported || localProcess?.confirmationSupported ? '部分支持' : '未实现'}
          hint="命令白名单、危险命令确认与工作目录覆盖目前都未接入服务端能力控制。"
          tone={localProcess?.commandAllowlistSupported || localProcess?.confirmationSupported ? 'enabled' : 'notice'}
        />
        <CapabilityRow
          icon={IconLock}
          label="用户级终端覆盖"
          value={localProcess?.userOverridesSupported ? '支持' : '未实现'}
          hint="如需约束本地进程工具，请修改工具绑定或服务端策略，而不是浏览器本地草稿设置。"
          tone={localProcess?.userOverridesSupported ? 'enabled' : 'blocked'}
        />
      </div>
    </div>
  );
}

// ─── 沙盒配置面板 ────────────────────────────────────────────────────────────

function SandboxConfigPanel() {
  const { data: config, isLoading } = useQuery({
    queryKey: ['security-config'],
    queryFn: getSecurityConfig,
    staleTime: 5 * 60 * 1_000,
  });

  const [showPatterns, setShowPatterns] = useState(false);

  if (isLoading) {
    return (
      <div className="bg-surface-card border border-border-subtle rounded-xl p-5">
        <div className="h-32 flex items-center justify-center text-text-muted text-sm">加载中…</div>
      </div>
    );
  }

  const sb = config?.sandbox;
  const sa = config?.subAgent;

  return (
    <div className="space-y-4">
      {/* JS 沙盒配置 */}
      <div className="bg-surface-card border border-border-subtle rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <IconCode size={14} className="text-accent" />
          <h3 className="text-sm font-semibold text-text">JS 沙盒配置</h3>
          <span className="ml-auto text-xs text-success flex items-center gap-1">
            <IconCircleCheck size={12} />
            已启用
          </span>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="bg-surface rounded-lg p-3 border border-border">
            <div className="text-xs text-text-muted mb-1">执行超时</div>
            <div className="text-sm font-semibold text-text">
              {sb ? fmtMs(sb.timeoutMs) : '—'}
            </div>
          </div>
          <div className="bg-surface rounded-lg p-3 border border-border">
            <div className="text-xs text-text-muted mb-1">最大输出</div>
            <div className="text-sm font-semibold text-text">
              {sb ? `${(sb.maxResultSizeChars / 1000).toFixed(0)}K 字符` : '—'}
            </div>
          </div>
          <div className="bg-surface rounded-lg p-3 border border-border">
            <div className="text-xs text-text-muted mb-1">禁止模式</div>
            <div className="text-sm font-semibold text-danger">
              {sb ? `${sb.forbiddenPatternCount} 条` : '—'}
            </div>
          </div>
        </div>

        <button
          className="flex items-center gap-1.5 text-xs text-accent hover:text-accent-hover transition-colors"
          onClick={() => setShowPatterns((v) => !v)}
        >
          <IconFilter size={12} />
          {showPatterns ? '收起禁止模式列表' : '展开禁止模式列表'}
        </button>

        {showPatterns && sb && (
          <div className="mt-3 rounded-lg border border-border overflow-hidden">
            <div className="bg-surface px-3 py-2 text-xs text-text-muted font-medium">
              静态安全扫描规则（FORBIDDEN_CODE_PATTERNS）
            </div>
            <div className="divide-y divide-border-subtle">
              {sb.forbiddenPatterns.map((p, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-1.5">
                  <span className="text-xs text-text-muted font-mono w-4">{i + 1}</span>
                  <span className="text-xs text-danger font-mono flex-1 truncate">{p.pattern}</span>
                  <span className="text-xs text-text-dim">{p.description}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Sub-Agent 安全配置 */}
      <SubAgentConfigPanel sa={sa} />

      {/* JS 沙盒运行时限制 */}
      <JSSandboxRuntimePanel sandbox={sb} />

      {/* 本地进程执行策略 */}
      <LocalProcessPolicyPanel sandbox={sb} />
    </div>
  );
}

// ─── 安全审计日志面板 ────────────────────────────────────────────────────────

function AuditLogPanel() {
  const [filterType, setFilterType] = useState<SecurityEventType | 'all'>('all');

  const { data: events = [], isLoading, refetch } = useQuery({
    queryKey: ['security-audit', filterType],
    queryFn: () =>
      getSecurityAudit({
        eventType: filterType === 'all' ? undefined : filterType,
        limit: 100,
      }),
    staleTime: 30_000,
  });

  return (
    <div className="bg-surface-card border border-border-subtle rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <IconAlertTriangle size={14} className="text-warn" />
        <h3 className="text-sm font-semibold text-text">安全审计日志</h3>
        <span className="ml-1 text-xs text-text-muted">（最近 100 条）</span>
        <div className="ml-auto flex items-center gap-2">
          {/* 类型过滤 */}
          <Select
            value={filterType}
            onValueChange={(v) => setFilterType(v as SecurityEventType | 'all')}
          >
            {EVENT_TYPE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </Select>
          <button
            onClick={() => refetch()}
            className="h-7 w-7 flex items-center justify-center rounded-lg bg-surface-soft hover:bg-surface-hover text-accent transition-colors"
            aria-label="刷新审计日志"
          >
            <IconRefresh size={13} />
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="h-32 flex items-center justify-center text-text-muted text-sm">加载中…</div>
      ) : events.length === 0 ? (
        <div className="h-32 flex flex-col items-center justify-center gap-2 text-text-muted">
          <IconCircleCheck size={28} className="text-success" />
          <span className="text-sm">
            {filterType !== 'all' ? `暂无 "${EVENT_TYPE_CONFIG[filterType as SecurityEventType]?.label}" 类型事件` : '暂无安全事件记录'}
          </span>
        </div>
      ) : (
        <ScrollArea className="h-80">
          <div className="divide-y divide-border-subtle">
            {events.map((e, i) => {
              const cfg = EVENT_TYPE_CONFIG[e.eventType];
              const Icon = cfg?.Icon ?? IconBolt;
              const detailLines = buildSandboxAuditDetailLines(e.details);
              return (
                <div key={e.eventId ?? i} className="flex items-start gap-3 py-2.5">
                  <Icon
                    size={13}
                    className={clsx('mt-0.5 shrink-0', cfg?.textCls ?? 'text-text-dim')}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={clsx('text-xs font-medium', cfg?.textCls ?? 'text-text-dim')}>
                        {cfg?.label ?? e.eventType}
                      </span>
                      <span className="text-xs text-text-muted">{e.agentId}</span>
                      <span className="text-xs text-text-muted ml-auto">{fmtTs(e.timestamp)}</span>
                    </div>
                    {detailLines.length > 0 && (
                      <div className="mt-1 space-y-1">
                        {detailLines.slice(0, 6).map((line) => (
                          <div key={line} className="text-[11px] text-text-dim font-mono leading-[1.45] break-all">
                            {line}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

// ─── SecurityTab 主入口 ──────────────────────────────────────────────────────

export function SecurityTab() {
  const [view, setView] = useState<'config' | 'audit'>('config');

  return (
    <div className="space-y-4">
      {/* 子导航 */}
      <div className="flex items-center gap-1">
        {([['config', '安全配置', IconShield], ['audit', '审计日志', IconAlertTriangle]] as const).map(
          ([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => setView(id)}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                view === id
                  ? 'bg-accent/15 text-accent'
                  : 'text-text-muted hover:text-text-dim hover:bg-surface-soft'
              )}
            >
              <Icon size={12} />
              {label}
            </button>
          )
        )}
      </div>

      {view === 'config' && <SandboxConfigPanel />}
      {view === 'audit' && <AuditLogPanel />}
    </div>
  );
}
