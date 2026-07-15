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

export type MaintainerTaskPacket = {
  kind: PacketKind;
  source: string;
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
