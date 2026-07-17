export type PacketKind = 'handoff' | 'triage' | 'review' | 'release';

export type PreflightStatus = 'pass' | 'warning' | 'blocked';

export type PreflightSeverity = 'info' | 'warning' | 'block';

export type PreflightFinding = {
  id: string;
  label: string;
  severity: PreflightSeverity;
  excerpt: string;
  advice: string;
};

export type PreflightResult = {
  status: PreflightStatus;
  scannedAt: string;
  findings: PreflightFinding[];
  limitation: string;
};

export type GitHubSourceProvenance = {
  sourceType: 'issue' | 'pull_request';
  repository: string;
  number: number;
  canonicalUrl: string;
};

export type MaintainerTaskPacket = {
  kind: PacketKind;
  source: string;
  sourceProvenance?: GitHubSourceProvenance;
  generatedAt: string;
  toolVersion: string;
  maintainerGoal: string;
  nonGoals: string[];
  currentContext: string[];
  importantComments: string[];
  relatedIssuesOrPrs: string[];
  repositoryInstructions: string[];
  technicalSurface: string[];
  riskChecklist: string[];
  intakeQualityCheck: string[];
  codexTaskPrompt: string;
  verificationPlan: string[];
  handoffNotes: string[];
  knownLimitations: string[];
  preflight: PreflightResult;
};
