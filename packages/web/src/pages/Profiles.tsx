import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  IconUsers,
  IconChevronDown,
  IconChevronRight,
  IconShieldCheck,
  IconActivity,
  IconBuildingStore,
  IconDeviceMobile,
  IconCurrencyDollar,
  IconMapPin,
  IconPackage,
  IconUser,
  IconCircleCheck,
  IconAlertTriangle,
  IconCircle,
  IconArrowsExchange,
  IconArrowUp,
  IconArrowDown,
  IconMinus,
  IconX,
  IconShare2,
} from '@tabler/icons-react';
import { clsx } from 'clsx';
import { listBusinessProfiles, getBusinessProfile, diffProfiles } from '../api/client';
import type { ProfileEntity, BehaviorStep, RiskAttribute } from '../api/client';
import { ScrollArea } from '../components/ui/ScrollArea';
import { Separator } from '../components/ui/Separator';

// ─── Entity icon mapping ──────────────────────────────────────────────────
function EntityIcon({ type }: { type: string }) {
  const sz = 14;
  switch (type) {
    case 'user':     return <IconUser size={sz} className="text-accent" />;
    case 'merchant': return <IconBuildingStore size={sz} className="text-warn" />;
    case 'device':   return <IconDeviceMobile size={sz} className="text-text-muted" />;
    case 'amount':   return <IconCurrencyDollar size={sz} className="text-success" />;
    case 'geo':      return <IconMapPin size={sz} className="text-danger" />;
    case 'order':    return <IconPackage size={sz} className="text-accent" />;
    default:         return <IconUsers size={sz} className="text-text-subtle" />;
  }
}

// ─── Score badge ──────────────────────────────────────────────────────────
function ScoreBadge({ score }: { score: number }) {
  const cls = score >= 70
    ? 'border-success/25 bg-success/10 text-success'
    : score >= 40
    ? 'border-warn/25 bg-warn/10 text-warn'
    : 'border-danger/25 bg-danger/10 text-danger';
  return (
    <span className={clsx('text-xs font-mono px-2 py-0.5 rounded-full border', cls)}>
      {score.toFixed(1)}
    </span>
  );
}

// ─── Coverage dimension row ───────────────────────────────────────────────
function DimensionRow({ attr }: { attr: RiskAttribute }) {
  const pct = Math.round(attr.coverageRatio * 100);
  const Icon = pct >= 70 ? IconCircleCheck : pct >= 40 ? IconAlertTriangle : IconCircle;
  const color = pct >= 70 ? 'text-success' : pct >= 40 ? 'text-warn' : 'text-danger';
  const barColor = pct >= 70 ? 'bg-success' : pct >= 40 ? 'bg-warn' : 'bg-danger';
  return (
    <div className="flex items-center gap-3 py-2">
      <Icon size={14} className={color} />
      <span className="w-24 text-xs capitalize text-text">{attr.dimension}</span>
      <div className="flex-1 h-1.5 overflow-hidden rounded-full bg-border">
        {/* eslint-disable-next-line react/forbid-component-props */}
        <div className={clsx('h-full rounded-full', barColor)} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-10 text-right text-xs font-mono text-text-muted">{pct}%</span>
      <span className="text-xs text-text-subtle">({attr.coveredCount}/{attr.totalExpected})</span>
    </div>
  );
}

// ─── Behavior chain ───────────────────────────────────────────────────────
function BehaviorList({ behaviors }: { behaviors: BehaviorStep[] }) {
  const { t } = useTranslation();

  if (!behaviors.length) {
    return <p className="py-2 text-xs text-text-subtle">{t('profiles.noBehaviorSteps', '暂无行为步骤')}</p>;
  }
  return (
    <ol className="space-y-1.5">
      {behaviors.map((b, i) => (
        <li key={i} className="flex items-start gap-2">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border-subtle bg-surface-soft text-[10px] font-mono text-accent">
            {i + 1}
          </span>
          <div>
            <span className="text-xs text-text">{b.action}</span>
            {b.riskKeyword && (
              <span className="ml-2 rounded border border-danger/20 bg-danger/10 px-1.5 py-0.5 text-[10px] text-danger">
                {b.riskKeyword}
              </span>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

// ─── Profile detail panel ────────────────────────────────────────────────
function ProfileDetail({ profileId }: { profileId: string }) {
  const { t } = useTranslation();
  const { data, isLoading } = useQuery({
    queryKey: ['profile', profileId],
    queryFn: () => getBusinessProfile(profileId)
  });

  if (isLoading) {
    return <div className="p-5 text-center text-sm text-text-subtle">{t('profiles.loading', '加载中...')}</div>;
  }
  if (!data) {
    return <div className="p-5 text-center text-sm text-danger">{t('profiles.loadFailed', '加载失败')}</div>;
  }

  return (
    <div className="p-5 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-text">{data.businessName}</h2>
          <p className="mt-0.5 text-xs text-text-subtle">v{data.version} · {data.createdAt?.slice(0, 19).replace('T', ' ')}</p>
        </div>
        <ScoreBadge score={data.overallScore} />
      </div>

      <Separator className="bg-border" />

      {/* Entities */}
      <div>
        <h3 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">
          <IconUsers size={12} />
          {t('profiles.entityTypes', '实体类型（{{count}}）', { count: data.entities.length })}
        </h3>
        {data.entities.length ? (
          <div className="flex flex-wrap gap-2">
            {data.entities.map((e: ProfileEntity) => (
              <div
                key={e.entityType}
                className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-soft px-2.5 py-1.5 text-xs"
              >
                <EntityIcon type={e.entityType} />
                <span className="text-text">{e.entityType}</span>
                <span className="text-text-subtle">×{e.count}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-text-subtle">{t('profiles.noEntityTypes', '未识别到实体类型')}</p>
        )}
      </div>

      <Separator className="bg-border" />

      {/* Behavior chain */}
      <div>
        <h3 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">
          <IconActivity size={12} />
          {t('profiles.behaviorChain', '行为风险链（{{count}} 步）', { count: data.behaviors.length })}
        </h3>
        <BehaviorList behaviors={data.behaviors} />
      </div>

      <Separator className="bg-border" />

      {/* Coverage dimensions */}
      <div>
        <h3 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">
          <IconShieldCheck size={12} />
          {t('profiles.dimensionCoverage', '风控维度覆盖')}
        </h3>
        {data.apiFeatures?.length ? (
          <div className="divide-y divide-border-subtle">
            {data.apiFeatures.map((attr: RiskAttribute) => (
              <DimensionRow key={attr.dimension} attr={attr} />
            ))}
          </div>
        ) : (
          <p className="text-xs text-text-subtle">{t('profiles.noDimensions', '暂无维度数据')}</p>
        )}
      </div>

      {/* Link to session */}
      {data.sessionId && (
        <>
          <Separator className="bg-border" />
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-subtle">{t('profiles.linkedSession', '关联分析会话')}</span>
            <Link
              to={`/sessions/${data.sessionId}`}
              className="text-xs text-accent transition-colors hover:text-accent-hover"
            >
              {t('profiles.viewSession', '查看会话')} →
            </Link>
          </div>
        </>
      )}

      {/* Link to Knowledge Graph */}
      <Separator className="bg-border" />
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-subtle">{t('profiles.knowledgeGraph', '知识图谱')}</span>
        <Link
          to={`/knowledge-graph?nodeId=${profileId}`}
          className="flex items-center gap-1 text-xs text-accent transition-colors hover:text-accent-hover"
        >
          <IconShare2 size={11} />
          {t('profiles.viewInGraph', '在图谱中查看')}
        </Link>
      </div>
    </div>
  );
}

// ─── Profile row in list ─────────────────────────────────────────────────
function ProfileRow({
  profile,
  selected,
  onSelect
}: {
  profile: { profileId: string; businessName: string; version: number; overallScore: number; createdAt: string };
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={clsx(
        'w-full flex items-center gap-3 px-4 py-3 text-left transition-colors',
        selected
          ? 'border-l-2 border-accent bg-accent/10'
          : 'border-l-2 border-transparent hover:bg-surface-card'
      )}
    >
      <div className="flex-1 min-w-0">
        <p className="truncate text-sm font-medium text-text">{profile.businessName}</p>
        <p className="mt-0.5 text-xs text-text-subtle">
          v{profile.version} · {profile.createdAt?.slice(0, 10)}
        </p>
      </div>
      <ScoreBadge score={profile.overallScore} />
      {selected
        ? <IconChevronDown size={14} className="shrink-0 text-accent" />
        : <IconChevronRight size={14} className="shrink-0 text-text-subtle" />
      }
    </button>
  );
}

// ─── Profile diff comparison view ────────────────────────────────────────
function ProfileDiffView({
  idA,
  idB,
  onClose,
}: {
  idA: string;
  idB: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { data, isLoading, error } = useQuery({
    queryKey: ['profile-diff', idA, idB],
    queryFn: () => diffProfiles(idA, idB),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-text-subtle">{t('profiles.diff.loading', '对比分析中…')}</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-sm text-danger">{t('profiles.diff.failed', '无法加载对比数据')}</p>
        <button onClick={onClose} className="text-xs text-accent hover:underline">{t('profiles.back', '返回')}</button>
      </div>
    );
  }

  const delta = data.scoreDelta;
  const DeltaIcon = delta > 0 ? IconArrowUp : delta < 0 ? IconArrowDown : IconMinus;
  const deltaColor = delta > 0 ? 'text-success' : delta < 0 ? 'text-danger' : 'text-text-subtle';

  return (
    <div className="w-full p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <IconArrowsExchange size={16} className="text-accent" />
          <h2 className="text-sm font-semibold text-text">{t('profiles.diff.title', '版本对比 · {{name}}', { name: data.businessName })}</h2>
        </div>
        <button
          onClick={onClose}
          title={t('profiles.diff.close', '关闭对比视图')}
          className="rounded-lg p-1.5 text-text-subtle transition-colors hover:bg-surface-soft hover:text-text"
        >
          <IconX size={14} />
        </button>
      </div>

      {/* Score comparison */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-border bg-surface-card p-4 text-center">
          <p className="mb-2 text-[10px] uppercase tracking-wider text-text-subtle">v{data.versionA}</p>
          <ScoreBadge score={data.scoreA} />
          <p className="mt-2 text-[10px] text-text-subtle">{t('profiles.diff.behaviorSteps', '{{count}} 步行为', { count: data.behaviorCountA })}</p>
        </div>
        <div className="flex flex-col items-center justify-center gap-1 rounded-xl border border-border bg-surface p-4">
          <DeltaIcon size={20} className={deltaColor} />
          <span className={clsx('text-lg font-mono font-bold', deltaColor)}>
            {delta > 0 ? '+' : ''}{delta.toFixed(1)}
          </span>
          <span className="text-[10px] text-text-subtle">{t('profiles.diff.scoreDelta', '评分变化')}</span>
        </div>
        <div className="rounded-xl border border-border bg-surface-card p-4 text-center">
          <p className="mb-2 text-[10px] uppercase tracking-wider text-text-subtle">v{data.versionB}</p>
          <ScoreBadge score={data.scoreB} />
          <p className="mt-2 text-[10px] text-text-subtle">{t('profiles.diff.behaviorSteps', '{{count}} 步行为', { count: data.behaviorCountB })}</p>
        </div>
      </div>

      {/* Entity changes */}
      {(data.addedEntities.length > 0 || data.removedEntities.length > 0) && (
        <div className="space-y-3 rounded-xl border border-border bg-surface-card p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">{t('profiles.diff.entityChanges', '实体变化')}</h3>
          {data.addedEntities.length > 0 && (
            <div>
              <p className="mb-1.5 text-[10px] text-success">{t('profiles.diff.added', '新增 ({{count}})', { count: data.addedEntities.length })}</p>
              <div className="flex flex-wrap gap-1.5">
                {data.addedEntities.map((e) => (
                  <span key={e.entityType} className="rounded border border-success/20 bg-success/10 px-2 py-0.5 text-[11px] text-success">
                    +{e.entityType}
                  </span>
                ))}
              </div>
            </div>
          )}
          {data.removedEntities.length > 0 && (
            <div>
              <p className="mb-1.5 text-[10px] text-danger">{t('profiles.diff.removed', '移除 ({{count}})', { count: data.removedEntities.length })}</p>
              <div className="flex flex-wrap gap-1.5">
                {data.removedEntities.map((e) => (
                  <span key={e.entityType} className="rounded border border-danger/20 bg-danger/10 px-2 py-0.5 text-[11px] text-danger">
                    -{e.entityType}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Dimension coverage changes */}
      {data.dimensionChanges.length > 0 && (
        <div className="space-y-3 rounded-xl border border-border bg-surface-card p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">{t('profiles.diff.dimensionChanges', '维度覆盖变化')}</h3>
          <div className="space-y-2">
            {data.dimensionChanges
              .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
              .map((dc) => {
                const d = dc.delta;
                const Arrow = d > 0 ? IconArrowUp : d < 0 ? IconArrowDown : IconMinus;
                const ac = d > 0 ? 'text-success' : d < 0 ? 'text-danger' : 'text-text-subtle';
                return (
                  <div key={dc.dimension} className="flex items-center gap-3 text-xs">
                    <span className="w-28 capitalize text-text">{dc.dimension}</span>
                    <span className="w-10 text-right text-text-subtle">{(dc.ratioA * 100).toFixed(0)}%</span>
                    <Arrow size={11} className={ac} />
                    <span className={clsx('w-10', ac)}>{(dc.ratioB * 100).toFixed(0)}%</span>
                    <span className={clsx('text-[10px] ml-1', ac)}>
                      ({d > 0 ? '+' : ''}{(d * 100).toFixed(0)}pp)
                    </span>
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────
export function Profiles() {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [diffIds, setDiffIds] = useState<[string, string] | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['profiles'], queryFn: listBusinessProfiles });

  const profiles = data ?? [];

  // group by businessName
  const byName: Record<string, typeof profiles> = {};
  for (const p of profiles) {
    (byName[p.businessName] ??= []).push(p);
  }

  return (
    <div className="flex min-h-0 flex-1 bg-surface">
      {/* Left: Profile list */}
      <div className="flex w-72 shrink-0 flex-col border-r border-border bg-surface-card/70">
        {/* Header */}
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
          <IconUsers size={14} className="text-accent" />
          <h1 className="text-sm font-semibold text-text">
            {t('profiles.title', '业务画像')}
          </h1>
          {profiles.length > 0 && (
            <span className="ml-auto text-xs text-text-subtle">{profiles.length}</span>
          )}
        </div>

        <ScrollArea className="flex-1">
          {isLoading ? (
            <p className="px-4 py-6 text-center text-xs text-text-subtle">{t('profiles.loading', '加载中...')}</p>
          ) : profiles.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-xs text-text-subtle">
                {t('profiles.empty', '暂无业务画像')}
              </p>
              <p className="mt-1 text-xs text-text-subtle">
                {t('profiles.generatedAfterAnalysis', '运行分析会话后自动生成')}
              </p>
            </div>
          ) : (
            Object.entries(byName).map(([name, group]) => (
              <div key={name}>
                {group.length > 1 && (
                  <div className="bg-surface px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-subtle">
                    {name}
                  </div>
                )}
                {group.map((p) => (
                  <ProfileRow
                    key={p.profileId}
                    profile={p}
                    selected={selectedId === p.profileId}
                    onSelect={() => setSelectedId(selectedId === p.profileId ? null : p.profileId)}
                  />
                ))}
              </div>
            ))
          )}
        </ScrollArea>
      </div>

      {/* Right: Profile detail / diff view */}
      <div className="flex-1 min-w-0">
        {diffIds ? (
          <ScrollArea className="h-full">
            <ProfileDiffView
              idA={diffIds[0]}
              idB={diffIds[1]}
              onClose={() => setDiffIds(null)}
            />
          </ScrollArea>
        ) : selectedId ? (
          <ScrollArea className="h-full">
            {/* Diff trigger: if this business has ≥2 versions */}
            {(() => {
              const profile = profiles.find((p) => p.profileId === selectedId);
              if (!profile) return null;
              const versions = (byName[profile.businessName] ?? []);
              if (versions.length < 2) return null;
              const sorted = [...versions].sort((a, b) => a.version - b.version);
              return (
                <div className="px-6 pt-5 pb-0 flex justify-end">
                  <button
                    onClick={() => setDiffIds([sorted[0].profileId, sorted[sorted.length - 1].profileId])}
                    className="flex items-center gap-1.5 rounded-lg border border-accent/20 bg-accent/10 px-3 py-1.5 text-xs text-accent transition-colors hover:bg-accent/20"
                  >
                    <IconArrowsExchange size={12} />
                    {t('profiles.compareVersions', '对比 v{{from}} → v{{to}}', { from: sorted[0].version, to: sorted[sorted.length - 1].version })}
                  </button>
                </div>
              );
            })()}
            <ProfileDetail profileId={selectedId} />
          </ScrollArea>
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center p-8">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-surface-card">
              <IconUsers size={24} className="text-text-subtle" />
            </div>
            <p className="text-sm text-text-subtle">
              {profiles.length
                ? t('profiles.selectOne', '从左侧选择一个业务画像查看详情')
                : t('profiles.runAnalysisToGenerate', '运行新分析以生成业务画像')}
            </p>
            {!profiles.length && (
              <Link
                to="/analysis"
                className="mt-1 text-xs text-accent transition-colors hover:text-accent-hover"
              >
                {t('profiles.startAnalysis', '开始分析')} →
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
