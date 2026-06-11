export type CapabilityKind = 'skill' | 'mcp-server' | 'connector' | 'script' | 'agent-spec';

export type CapabilityIntent = 'inspect' | 'test' | 'acquire' | 'debug' | 'connect';

export type CapabilityAvailability = 'available' | 'missing' | 'planned' | 'blocked';

export type CapabilityTrustLevel = 'trusted' | 'review' | 'untrusted';

export type CapabilitySourceKind = 'installed' | 'directory' | 'catalog' | 'url' | 'generated';

export type CapabilityAcquisitionStepKind =
  | 'discover'
  | 'fetch'
  | 'security-scan'
  | 'dry-run'
  | 'install'
  | 'health-check'
  | 'refresh-tools'
  | 'verify'
  | 'promote';

export type CapabilityStepStatus = 'pending' | 'ready' | 'blocked';

export interface CapabilitySourceCandidate {
  kind: CapabilitySourceKind;
  identifier: string;
  label: string;
  trust: CapabilityTrustLevel;
  installed: boolean;
}

export interface CapabilityAcquisitionStep {
  kind: CapabilityAcquisitionStepKind;
  status: CapabilityStepStatus;
  reason?: string;
}

export interface CapabilityAcquisitionPlan {
  capabilityKind: CapabilityKind;
  capabilityName: string;
  intent: CapabilityIntent;
  availability: CapabilityAvailability;
  candidates: CapabilitySourceCandidate[];
  requiredCapabilities: string[];
  steps: CapabilityAcquisitionStep[];
  recommendedNextAction: 'discover' | 'dry-run' | 'verify' | 'none';
}