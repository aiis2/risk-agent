import type { StreamEventLike } from '../hooks/useAgentProgress';

export function AgentTimeline({ events }: { events: StreamEventLike[] }) {
  if (!events.length) {
    return <div className="timeline timeline--empty">waiting for events…</div>;
  }
  return (
    <div className="timeline">
      {events.map((e, i) => (
        <div className="timeline__item" key={i}>
          <strong>{e.type}</strong>
          {renderSummary(e)}
        </div>
      ))}
    </div>
  );
}

function renderSummary(e: StreamEventLike): string {
  switch (e.type) {
    case 'system_init': return ` · session=${String(e.sessionId)} model=${String(e.model)}`;
    case 'turn_info': return ` · turn=${String(e.turn)} phase=${String(e.phase)}`;
    case 'tool_partition_info':
      return ` · interrupt=${(e.interrupt as any[])?.length ?? 0} parallel=${(e.parallel as any[])?.length ?? 0} serial=${(e.serial as any[])?.length ?? 0}`;
    case 'tool_start': return ` · ${String(e.toolName)}`;
    case 'tool_complete': return ` · ${String(e.toolName)} ok`;
    case 'tool_error': return ` · ${String(e.toolName ?? '')} error: ${String(e.error ?? '')}`;
    case 'research_progress': return ` · ${String(e.dimension)} ${String(e.progress ?? '')}`;
    case 'research_complete': return ` · ok`;
    case 'cost_update': return ` · usd=${String(e.cumulativeUsd ?? 0)}`;
    case 'usage_summary': return ` · ${JSON.stringify(e.summary ?? {})}`;
    case 'text_delta': return `: ${String((e.delta ?? '') as string).slice(0, 60)}`;
    case 'result': return ` · ${String(e.summary ?? '')}`;
    // v3.3 §30 Dream Task events
    case 'dream_task_notification': return ` · task=${String(e.taskId)} status=${String(e.status)}`;
    // v3.3 §28 Coordinator mode events
    case 'correction_start': return ` · round=${String(e.round)}`;
    case 'correction_complete': return ` · round=${String(e.round)} result=${String(e.result)}`;
    case 'memory_write': return ` · category=${String(e.category)}`;
    default: return '';
  }
}
