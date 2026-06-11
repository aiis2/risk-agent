/**
 * UserProfileSection — 用户画像 Settings 标签页
 *
 * 功能：
 * - 显示并编辑用户基本信息（displayName、traits、preferences）
 * - 查看 learnedFacts（从对话中学到的用户偏好）
 * - 重置画像
 */

import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  IconBrain,
  IconCircleCheck,
  IconLoader2,
  IconRefresh,
  IconTrash,
  IconUser,
  IconX,
} from '@tabler/icons-react';
import {
  getUserProfile,
  updateUserProfile,
  resetUserProfile,
} from '../../../api/client';
import { Dialog, DialogContent } from '../../ui/Dialog';
import { ScrollArea } from '../../ui/ScrollArea';

const inputCls =
  'w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus:border-accent/50 transition-colors';
const btnPrimary =
  'flex items-center gap-1.5 rounded-lg bg-accent/15 px-3 py-1.5 text-sm text-accent transition-colors hover:bg-accent/25 disabled:opacity-50';
const btnDanger =
  'flex items-center gap-1.5 rounded-lg bg-danger/10 px-3 py-1.5 text-sm text-danger transition-colors hover:bg-danger/20 disabled:opacity-50';

export function UserProfileSection() {
  const qc = useQueryClient();
  const [resetConfirm, setResetConfirm] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [editMode, setEditMode] = useState(false);

  const { data: profile, isLoading } = useQuery({
    queryKey: ['user-profile'],
    queryFn: getUserProfile,
  });

  useEffect(() => {
    if (profile?.displayName) setDisplayName(profile.displayName);
  }, [profile?.displayName]);

  const doSave = useMutation({
    mutationFn: () => updateUserProfile({ displayName: displayName.trim() || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user-profile'] });
      setEditMode(false);
    },
  });

  const doReset = useMutation({
    mutationFn: resetUserProfile,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user-profile'] });
      setResetConfirm(false);
    },
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <IconLoader2 size={20} className="animate-spin text-text-muted" />
      </div>
    );
  }

  const facts = profile?.learnedFacts ?? [];
  const traits = profile?.traits ?? {};
  const prefs = profile?.preferences ?? {};

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-text">用户画像</h2>
          <p className="mt-0.5 text-xs text-text-muted">AI 会根据你的画像和偏好个性化回复方式</p>
        </div>
        <button type="button" onClick={() => setResetConfirm(true)} className={btnDanger}>
          <IconRefresh size={14} />
          重置画像
        </button>
      </div>

      {/* Basic info */}
      <div className="rounded-xl border border-border bg-surface-card p-4 space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-soft text-accent">
            <IconUser size={18} />
          </div>
          <div className="flex-1 min-w-0">
            {editMode ? (
              <div className="flex items-center gap-2">
                <input
                  className={`${inputCls} flex-1`}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="输入显示名称"
                  autoFocus
                />
                <button type="button" onClick={() => doSave.mutate()} disabled={doSave.isPending} className={btnPrimary}>
                  {doSave.isPending ? <IconLoader2 size={14} className="animate-spin" /> : <IconCircleCheck size={14} />}
                </button>
                <button type="button" title="取消" onClick={() => setEditMode(false)} className="rounded-lg p-1.5 text-text-muted hover:text-text transition-colors">
                  <IconX size={14} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setEditMode(true)}
                className="text-left group"
              >
                <span className="block text-sm font-medium text-text group-hover:text-accent transition-colors">
                  {profile?.displayName || '点击设置显示名称'}
                </span>
                <span className="text-xs text-text-muted">Owner: {profile?.ownerKey ?? 'local-default'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Version info */}
        <div className="flex items-center gap-4 pt-2 border-t border-border">
          <div className="text-center">
            <div className="text-xs text-text-muted">版本</div>
            <div className="text-sm font-medium text-text">{profile?.version ?? 1}</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-text-muted">记忆事实</div>
            <div className="text-sm font-medium text-text">{facts.length}</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-text-muted">创建于</div>
            <div className="text-sm font-medium text-text">
              {profile?.createdAt ? new Date(profile.createdAt).toLocaleDateString('zh-CN') : '—'}
            </div>
          </div>
        </div>
      </div>

      {/* Learned Facts */}
      {facts.length > 0 && (
        <div>
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium text-text-dim">
            <IconBrain size={12} />
            从对话中学到的偏好 ({facts.length})
          </h3>
          <ScrollArea className="max-h-48">
            <div className="space-y-1.5">
              {facts.map((fact, i) => (
                <div key={i} className="flex items-start gap-2 rounded-lg bg-surface-card border border-border px-3 py-2">
                  <div className="mt-0.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent" />
                  <span className="text-xs text-text-dim leading-relaxed">{fact.value}</span>
                  {fact.learnedAt && (
                    <span className="ml-auto flex-shrink-0 text-[10px] text-text-muted">
                      {new Date(fact.learnedAt).toLocaleDateString('zh-CN')}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* Traits */}
      {Object.keys(traits).length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-medium text-text-dim">特征 (Traits)</h3>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(traits).map(([k, v]) => (
              <span key={k} className="rounded-md bg-surface-soft px-2 py-1 text-[11px] text-text-dim">
                <span className="text-text-muted">{k}:</span> {String(v)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Preferences */}
      {Object.keys(prefs).length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-medium text-text-dim">偏好设置 (Preferences)</h3>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(prefs).map(([k, v]) => (
              <span key={k} className="rounded-md bg-surface-soft px-2 py-1 text-[11px] text-text-dim">
                <span className="text-text-muted">{k}:</span> {String(v)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {facts.length === 0 && Object.keys(traits).length === 0 && (
        <div className="rounded-xl border border-dashed border-border py-8 text-center">
          <IconBrain size={28} className="mx-auto mb-2 text-border" />
          <p className="text-sm text-text-muted">画像还是空的</p>
          <p className="mt-1 text-xs text-text-muted">多和 AI 聊几轮，画像会自动丰富</p>
        </div>
      )}

      {/* Reset confirm */}
      <Dialog open={resetConfirm} onOpenChange={(v) => !v && setResetConfirm(false)}>
        <DialogContent className="bg-surface-card border border-border rounded-xl p-6 max-w-sm">
          <h3 className="text-sm font-semibold text-text mb-2">重置用户画像</h3>
          <p className="text-xs text-text-dim mb-4">
            这将清除所有学到的偏好、特征和记忆事实。此操作不可恢复。
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setResetConfirm(false)} className="px-4 py-1.5 text-sm text-text-dim hover:text-text transition-colors">
              取消
            </button>
            <button
              type="button"
              disabled={doReset.isPending}
              onClick={() => doReset.mutate()}
              className={btnDanger}
            >
              {doReset.isPending ? <IconLoader2 size={14} className="animate-spin" /> : <IconTrash size={14} />}
              确认重置
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
