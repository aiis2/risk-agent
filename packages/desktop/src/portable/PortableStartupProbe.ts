export type PortableProcessInfo = {
  processId: number;
  parentProcessId: number | null;
};

type PortableProcessRecord = PortableProcessInfo | {
  ProcessId: number;
  ParentProcessId: number | null;
};

export type PortableListenerInfo = {
  localAddress: string;
  localPort: number;
  owningProcess: number;
};

type PortableListenerRecord = PortableListenerInfo | {
  LocalAddress: string;
  LocalPort: number;
  OwningProcess: number;
};

export type PortableProbeResult = {
  port: number;
  statusCode: number;
  body?: string;
};

export function normalizePortableProcesses(processes: PortableProcessRecord[]): PortableProcessInfo[] {
  return processes.map((processInfo) => {
    if ('processId' in processInfo) {
      return processInfo;
    }

    return {
      processId: processInfo.ProcessId,
      parentProcessId: processInfo.ParentProcessId,
    };
  });
}

export function normalizePortableListeners(listeners: PortableListenerRecord[]): PortableListenerInfo[] {
  return listeners.map((listenerInfo) => {
    if ('localPort' in listenerInfo) {
      return listenerInfo;
    }

    return {
      localAddress: listenerInfo.LocalAddress,
      localPort: listenerInfo.LocalPort,
      owningProcess: listenerInfo.OwningProcess,
    };
  });
}

export function collectDescendantProcessIds(
  launcherProcessId: number,
  processes: PortableProcessInfo[],
): number[] {
  const descendantProcessIds = new Set<number>([launcherProcessId]);
  const pendingProcessIds = [launcherProcessId];

  while (pendingProcessIds.length > 0) {
    const parentProcessId = pendingProcessIds.shift();
    if (parentProcessId === undefined) {
      continue;
    }

    for (const processInfo of processes) {
      if (processInfo.parentProcessId !== parentProcessId) {
        continue;
      }

      if (descendantProcessIds.has(processInfo.processId)) {
        continue;
      }

      descendantProcessIds.add(processInfo.processId);
      pendingProcessIds.push(processInfo.processId);
    }
  }

  return Array.from(descendantProcessIds);
}

function isRiskAgentUiDocument(body?: string): boolean {
  if (!body) {
    return false;
  }

  const normalizedBody = body.toLowerCase();
  return normalizedBody.includes('<!doctype html')
    && normalizedBody.includes('<title>risk agent</title>')
    && normalizedBody.includes('<div id="root"></div>');
}

export function selectPortableUiEndpoint(options: {
  launcherProcessId: number;
  processes: PortableProcessInfo[];
  listeners: PortableListenerInfo[];
  probes: PortableProbeResult[];
}): { port: number; owningProcess: number } | null {
  const descendantProcessIds = new Set(
    collectDescendantProcessIds(options.launcherProcessId, options.processes),
  );

  for (const listener of options.listeners) {
    if (!descendantProcessIds.has(listener.owningProcess)) {
      continue;
    }

    const probe = options.probes.find((entry) => entry.port === listener.localPort);
    if (!probe || probe.statusCode !== 200) {
      continue;
    }

    if (!isRiskAgentUiDocument(probe.body)) {
      continue;
    }

    return {
      port: listener.localPort,
      owningProcess: listener.owningProcess,
    };
  }

  return null;
}