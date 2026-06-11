import { useState } from 'react';
import { IconSend, IconPlayerSkipForward, IconShieldCheck } from '@tabler/icons-react';

interface InterventionPanelProps {
  runId: string;
  status: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  /** Called when user wants to skip/dismiss the pending request */
  onSkip?: () => void;
  busy: boolean;
  /** Pending question from waiting_user event */
  pendingQuestion?: string;
  /** Options provided by the agent for AG2U selection */
  pendingOptions?: string[];
}

export function InterventionPanel({
  status,
  value,
  onChange,
  onSubmit,
  onSkip,
  busy,
  pendingQuestion,
  pendingOptions = [],
}: InterventionPanelProps) {
  const [selectedOption, setSelectedOption] = useState<number | null>(null);

  if (status !== 'waiting_user') {
    return (
      <div className="rounded-[24px] border border-border bg-surface-card/88 p-4 text-sm text-text-muted">
        当前没有需要人工介入的步骤。
      </div>
    );
  }

  const hasOptions = pendingOptions.length > 0;

  const handleOptionClick = (idx: number, option: string) => {
    setSelectedOption(idx);
    onChange(option);
  };

  const handleSubmit = () => {
    setSelectedOption(null);
    onSubmit();
  };

  return (
    <div className="rounded-[26px] border border-warning/30 bg-warning/8 p-4 shadow-[0_14px_30px_rgba(0,0,0,0.12)]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-warning/25 bg-surface/65 px-2.5 py-1 text-[11px] uppercase tracking-[0.2em] text-warning">等待决策</span>
        <h3 className="text-sm font-semibold text-text">Agent 需要你的输入</h3>
        {onSkip && (
          <button
            type="button"
            onClick={onSkip}
            disabled={busy}
            className="ml-auto flex items-center gap-1 rounded-full border border-border/30 bg-surface-card/40 px-2.5 py-1 text-[11px] text-text-subtle/70 transition-colors hover:bg-surface-card/70 hover:text-text-muted disabled:opacity-40"
            title="跳过此步骤，继续执行"
          >
            <IconPlayerSkipForward size={11} />
            跳过
          </button>
        )}
      </div>
      {pendingQuestion && (
        <p className="mt-3 text-sm leading-6 text-text rounded-[18px] border border-warning/20 bg-surface/50 px-4 py-3">
          {pendingQuestion}
        </p>
      )}
      {!pendingQuestion && (
        <p className="mt-2 text-xs leading-6 text-text-muted">通过一条补充消息继续当前流程，系统会在收到输入后恢复执行。</p>
      )}
      {hasOptions && (
        <div className="mt-3 space-y-2">
          <p className="text-[11px] uppercase tracking-widest text-text-subtle">选择一个方向</p>
          {pendingOptions.map((option, idx) => {
            const isSessionApproveAll = option === '当前会话都批准';
            const isSelected = selectedOption === idx;
            return (
              <button
                key={idx}
                type="button"
                onClick={() => handleOptionClick(idx, option)}
                className={`w-full rounded-[18px] border px-4 py-3 text-left text-sm transition-colors ${
                  isSessionApproveAll
                    ? isSelected
                      ? 'border-success/50 bg-success/15 text-text'
                      : 'border-success/25 bg-success/6 text-text-muted hover:border-success/40 hover:bg-success/10 hover:text-text'
                    : isSelected
                      ? 'border-accent/40 bg-accent/12 text-text'
                      : 'border-border bg-surface text-text-muted hover:border-accent/25 hover:text-text'
                }`}
              >
                {isSessionApproveAll ? (
                  <span className="flex items-center gap-2">
                    <IconShieldCheck size={15} className={isSelected ? 'text-success' : 'text-success/60'} />
                    <span>{option}</span>
                  </span>
                ) : option}
              </button>
            );
          })}
        </div>
      )}
      <div className="mt-3 space-y-2">
        {hasOptions && (
          <p className="text-[11px] text-text-subtle">或者直接输入自定义回复：</p>
        )}
        <textarea
          value={value}
          onChange={(e) => {
            setSelectedOption(null);
            onChange(e.target.value);
          }}
          placeholder={hasOptions ? '或输入自定义回复...' : '输入你的决策或补充说明...'}
          className="min-h-[100px] w-full rounded-[22px] border border-border bg-surface px-4 py-3 text-sm text-text outline-none placeholder:text-text-subtle focus:border-accent/40"
        />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={busy || !value.trim()}
          className="inline-flex items-center gap-2 rounded-[18px] bg-accent px-4 py-2 text-sm font-medium text-white shadow-[0_14px_24px_rgba(0,0,0,0.18)] disabled:opacity-50"
        >
          <IconSend size={16} />
          提交决策
        </button>
        {onSkip && (
          <span className="text-[11px] text-text-subtle/50">或</span>
        )}
        {onSkip && (
          <button
            type="button"
            onClick={onSkip}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-[18px] border border-border/30 px-3 py-2 text-[12px] text-text-muted transition-colors hover:bg-surface-card/50 disabled:opacity-40"
          >
            <IconPlayerSkipForward size={13} />
            跳过此步骤
          </button>
        )}
      </div>
    </div>
  );
}
