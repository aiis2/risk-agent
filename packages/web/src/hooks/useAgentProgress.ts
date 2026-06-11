import { useEffect, useRef, useState } from 'react';
import { buildApiUrl } from '../api/client';

export interface StreamEventLike {
  type: string;
  [key: string]: unknown;
}

/**
 * Connects to the session SSE stream and optionally replays persisted history.
 */
export function useAgentProgress(sessionId: string | null, loadHistory = false, reconnectKey = 0) {
  const [events, setEvents] = useState<StreamEventLike[]>([]);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'open' | 'closed' | 'error'>('idle');
  const [transport, setTransport] = useState<'sse'>('sse');
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setEvents([]);
      setStatus('idle');
      return;
    }

    setEvents([]);
    setStatus('connecting');

    let cancelled = false;
    let completed = false;
    let opened = false;

    setTransport('sse');
    const url = new URL(buildApiUrl(`/sessions/${sessionId}/stream`), window.location.origin);
    url.searchParams.set('history', loadHistory ? '1' : '0');

    const source = new EventSource(url);
    sourceRef.current = source;

    source.onopen = () => {
      opened = true;
      if (!cancelled) {
        setStatus('open');
      }
    };

    source.onmessage = (ev) => {
      if (cancelled) return;
      try {
        const data = JSON.parse(ev.data) as StreamEventLike;
        setEvents((prev) => [...prev, data]);
        if (data.type === 'result' || data.type === 'query_stopped' || data.type === 'done' || data.type === 'error') {
          completed = true;
          source.close();
          setStatus('closed');
        }
      } catch {
        // ignore malformed SSE frames
      }
    };

    source.onerror = () => {
      if (completed || source.readyState === EventSource.CLOSED || (opened && source.readyState !== EventSource.OPEN)) {
        if (!cancelled) {
          setStatus('closed');
        }
        return;
      }
      if (!cancelled) {
        setStatus('error');
      }
    };

    return () => {
      cancelled = true;
      try {
        sourceRef.current?.close();
      } catch {
        /* ignore */
      }
    };
  }, [sessionId, loadHistory, reconnectKey]);

  return { events, status, transport };
}
