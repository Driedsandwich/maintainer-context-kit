import { VERSION } from '../version.ts';
import { runPreflight, redactSensitiveText } from '../packet/preflight.ts';
import { renderMaintainerTaskPacket } from '../packet/renderMaintainerTaskPacket.ts';
import type { MaintainerTaskPacket } from '../packet/types.ts';
import { parseJsonObject } from '../utils/safeJson.ts';
import { runReadOnlyCommand, type ReadOnlyCommandResult, type ReadOnlyCommandRunner } from '../shell/runReadOnlyCommand.ts';
import { buildRepositoryVerificationSteps, targetMatchesLocalGitHubRepository, UNCONFIRMED_REPOSITORY_VERIFICATION } from './repositoryVerificationPlan.ts';
import { resolveGitHubSourceProvenance, sourceLabel, validateExplicitSourceTarget } from './sourceProvenance.ts';

export type TriageOptions = {
  cwd?: string;
  generatedAt?: string;
  runCommand?: ReadOnlyCommandRunner;
};

type IssueView = {
  number?: number;
  title?: string;
  state?: string;
  author?: { login?: string } | null;
  labels?: Array<{ name?: string }>;
  body?: string;
  comments?: Array<{ author?: { login?: string } | null; body?: string; createdAt?: string }>;
  url?: string;
  createdAt?: string;
  updatedAt?: string;
};

function commandLine(argv: readonly string[]): string {
  return argv.join(' ');
}

function run(
  name: string,
  argv: readonly string[],
  runCommand: ReadOnlyCommandRunner,
  cwd: string,
): ReadOnlyCommandResult & { name: string; command: string } {
  return {
    ...runCommand(argv, { cwd, maxOutputChars: 8000 }),
    name,
    command: commandLine(argv),
  };
}

function summarizeCommand(result: ReadOnlyCommandResult & { name: string; command: string }): string {
  if (!result.allowed) {
    return `${result.name}: blocked by policy (${result.reason}).`;
  }
  if (!result.ok) {
    const detail = result.error || result.stderr.trim() || `exit ${result.exitCode ?? 'unknown'}`;
    return `${result.name}: unavailable or failed (${redactSensitiveText(detail)}).`;
  }
  return `${result.name}: available.`;
}

function excerpt(text: string | undefined, maxLength = 700): string {
  const normalized = redactSensitiveText((text ?? '').replace(/\s+/g, ' ').trim());
  if (!normalized) {
    return '(empty)';
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}… [excerpt truncated]`;
}

function hasAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function buildIntakeQualityCheck(issue: IssueView, rawText: string, findingCount: number): string[] {
  const text = rawText.toLowerCase();
  const checks: string[] = [];

  checks.push(hasAny(text, [/steps? to reproduce/i, /repro/i, /minimal reproduction/i])
    ? 'Reproduction steps: present or partially present.'
    : 'Reproduction steps: missing or unclear.');
  checks.push(hasAny(text, [/expected/i, /should/i])
    ? 'Expected behavior: present or inferable.'
    : 'Expected behavior: missing or unclear.');
  checks.push(hasAny(text, [/actual/i, /observed/i, /instead/i, /error/i])
    ? 'Actual behavior: present or inferable.'
    : 'Actual behavior: missing or unclear.');
  checks.push(hasAny(text, [/environment/i, /node/i, /browser/i, /os\b/i, /version/i, /platform/i])
    ? 'Environment: present or partially present.'
    : 'Environment: missing or unclear.');
  checks.push((issue.title ?? '').length >= 10 || (issue.body ?? '').length >= 120
    ? 'Specificity: enough detail for initial maintainer review.'
    : 'Specificity: likely too thin; ask for more concrete details.');
  checks.push(hasAny(text, [/security/i, /vulnerability/i, /exploit/i, /xss/i, /rce/i, /credential/i])
    ? 'Security claim evidence: security-like terms are present; verify evidence before action.'
    : 'Security claim evidence: no explicit security claim detected.');
  checks.push(findingCount > 0
    ? `Sensitive-data exposure: preflight produced ${findingCount} finding(s); review before sharing externally.`
    : 'Sensitive-data exposure: no obvious pattern found by best-effort preflight.');

  return checks;
}

function labelSummary(labels: IssueView['labels']): string {
  const names = (labels ?? [])
    .map((label) => label.name)
    .filter((name): name is string => Boolean(name))
    .map(redactSensitiveText);
  return names.length > 0 ? names.join(', ') : 'none';
}

function failurePreflightText(target: string, result: ReadOnlyCommandResult): string {
  return [target, result.reason, result.error, result.stderr].filter(Boolean).join('\n');
}

function commentSummaries(comments: IssueView['comments']): string[] {
  const list = (comments ?? []).slice(0, 3);
  if (list.length === 0) {
    return ['No issue comments returned.'];
  }
  return list.map((comment, index) => {
    const author = comment.author?.login ? redactSensitiveText(comment.author.login) : 'unknown';
    const created = comment.createdAt ? ` at ${comment.createdAt}` : '';
    return `Comment ${index + 1} by ${author}${created}: ${excerpt(comment.body, 420)}`;
  });
}

function buildFailurePacket(target: string, result: ReadOnlyCommandResult & { name: string; command: string }, generatedAt: string): MaintainerTaskPacket {
  const failureText = summarizeCommand(result);
  const preflight = runPreflight(failurePreflightText(target, result), generatedAt);
  const safeTarget = redactSensitiveText(target).replace(/\s+/g, ' ').trim().slice(0, 240) || 'unknown';

  return {
    kind: 'triage',
    source: `issue/${safeTarget}`,
    generatedAt,
    toolVersion: VERSION,
    maintainerGoal: 'Determine why issue context could not be collected and what local prerequisite is missing.',
    nonGoals: ['Do not write to GitHub.', 'Do not call an external LLM API.', 'Do not guess issue contents.'],
    currentContext: [failureText],
    importantComments: ['Issue content was not collected.'],
    relatedIssuesOrPrs: ['Unknown because issue collection failed.'],
    repositoryInstructions: ['Follow AGENTS.md and CLAUDE.md.'],
    technicalSurface: ['GitHub CLI issue view.', 'Read-only command policy.'],
    riskChecklist: ['Fix local `gh` / auth / repository context before relying on this packet.', 'Do not infer issue details from a failed collection.'],
    intakeQualityCheck: ['Unavailable because issue collection failed.'],
    codexTaskPrompt: 'Do not implement from this packet. First resolve the read-only issue collection failure.',
    verificationPlan: [UNCONFIRMED_REPOSITORY_VERIFICATION, 'Run mck doctor --json using the documented local CLI invocation.', 'Re-run mck triage <issue-number-or-url> after fixing prerequisites.'],
    handoffNotes: ['Collection failed without crashing the CLI.'],
    knownLimitations: ['No issue metadata, body, or comments were available.'],
    preflight,
  };
}

export function buildSyntheticTriagePacket(generatedAt: string = new Date().toISOString()): MaintainerTaskPacket {
  const sourceText = [
    'Synthetic issue triage demo.',
    'Issue title: CLI should show a clear error when a command is not implemented.',
    'Expected behavior: user sees a clear unsupported-command message.',
    'Actual behavior: command currently returns a generic error.',
    'Environment: Node 24, local repository, GitHub CLI available.',
  ].join('\n');

  const preflight = runPreflight(sourceText, generatedAt);

  return {
    kind: 'triage',
    source: 'synthetic/demo-repository#101',
    generatedAt,
    toolVersion: VERSION,
    maintainerGoal: 'Decide whether the synthetic issue is actionable and what information is still missing.',
    nonGoals: ['Do not write to GitHub.', 'Do not call an external LLM API.', 'Do not treat this synthetic packet as real issue analysis.'],
    currentContext: ['The issue is a synthetic public-safe example for testing triage packet shape.', 'The report describes a missing or unclear command behavior.', 'The command scope should stay local-first and read-only.'],
    importantComments: ['No maintainer comment exists in this synthetic fixture.', 'No user-provided private data is included.'],
    relatedIssuesOrPrs: ['Synthetic related issue: #100 command help polish.', 'Synthetic related PR: #102 improve CLI error text.'],
    repositoryInstructions: ['Follow AGENTS.md and CLAUDE.md.', 'Keep one issue to one PR.', 'Do not add GitHub write operations.'],
    technicalSurface: ['CLI command routing.', 'User-facing error message.', 'Help text and runbook documentation.'],
    riskChecklist: ['Confirm the requested behavior is within v0.1 scope.', 'Confirm no GitHub write operation is needed.', 'Confirm no external LLM API call is needed.', 'Confirm the issue does not contain sensitive data before sharing externally.'],
    intakeQualityCheck: ['Reproduction steps: partial; command name is present but exact command line should be confirmed.', 'Expected behavior: present.', 'Actual behavior: present.', 'Environment: present but minimal.', 'Specificity: actionable for a small CLI messaging PR.', 'Security claim evidence: not applicable; no security claim is made.', 'Sensitive-data exposure: no obvious sensitive data in this synthetic fixture.'],
    codexTaskPrompt: 'Use this triage packet to decide the smallest safe implementation step. Do not write to GitHub, do not call external LLM APIs, and preserve v0.1 scope.',
    verificationPlan: [UNCONFIRMED_REPOSITORY_VERIFICATION, 'Re-run mck triage --demo using the documented local CLI invocation.', 'Confirm output includes intake quality checks.', 'Confirm preflight result and limitation wording are present.'],
    handoffNotes: ['This is a synthetic demo packet for validating issue-focused triage structure.', 'Real issue collection should be added in a later PR after masking and body/comment boundaries are reviewed.'],
    knownLimitations: ['Synthetic demo only.', 'Does not inspect actual GitHub issues or comments.', 'Does not perform duplicate detection.', 'Does not prove the packet is safe to share publicly.'],
    preflight,
  };
}

export function buildIssueTriagePacket(target: string, options: TriageOptions = {}): MaintainerTaskPacket {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const cwd = options.cwd ?? process.cwd();
  const runCommand = options.runCommand ?? runReadOnlyCommand;
  const fields = 'number,title,state,author,labels,body,comments,url,createdAt,updatedAt';
  const result = run('gh issue view', ['gh', 'issue', 'view', target, '--comments', '--json', fields], runCommand, cwd);

  if (!result.ok) {
    return buildFailurePacket(target, result, generatedAt);
  }

  const parsed = parseJsonObject<IssueView>(result.stdout);
  if (!parsed.ok) {
    const failure: ReadOnlyCommandResult & { name: string; command: string } = { ...result, ok: false, stderr: parsed.error, name: result.name, command: result.command };
    return buildFailurePacket(target, failure, generatedAt);
  }

  const issue = parsed.value;
  const provenance = resolveGitHubSourceProvenance('issue', issue.url, issue.number);
  if (!provenance.ok) {
    return buildFailurePacket(target, { ...result, ok: false, stderr: `Source provenance validation failed: ${provenance.error}.` }, generatedAt);
  }
  const targetValidation = validateExplicitSourceTarget(target, provenance.value);
  if (!targetValidation.ok) {
    return buildFailurePacket(target, { ...result, ok: false, stderr: `Source provenance validation failed: ${targetValidation.error}.` }, generatedAt);
  }
  const gitRoot = run('git root', ['git', 'rev-parse', '--show-toplevel'], runCommand, cwd);
  const gitRemotes = run('git remotes', ['git', 'remote', '-v'], runCommand, cwd);
  const rawText = [
    target,
    issue.title,
    issue.author?.login,
    ...(issue.labels ?? []).map((label) => label.name ?? ''),
    issue.body,
    ...(issue.comments ?? []).flatMap((comment) => [comment.author?.login ?? '', comment.body ?? '']),
  ].join('\n');
  const preflight = runPreflight(rawText, generatedAt);
  const title = redactSensitiveText(issue.title ?? '(untitled)');
  const author = issue.author?.login ? redactSensitiveText(issue.author.login) : 'unknown';
  const source = sourceLabel(provenance.value);
  const localRepositoryConfirmed = gitRoot.ok
    && gitRemotes.ok
    && targetMatchesLocalGitHubRepository(issue.url, gitRemotes.stdout);
  const repositoryRoot = localRepositoryConfirmed ? gitRoot.stdout.trim() || undefined : undefined;

  return {
    kind: 'triage',
    source,
    sourceProvenance: provenance.value,
    generatedAt,
    toolVersion: VERSION,
    maintainerGoal: 'Decide whether the issue is actionable, what information is missing, and the next smallest safe maintainer action.',
    nonGoals: ['Do not write to GitHub.', 'Do not call an external LLM API.', 'Do not post a triage comment automatically.', 'Do not label, close, reopen, or update the issue automatically.'],
    currentContext: [`Title: ${title}.`, `State: ${issue.state ?? 'unknown'}.`, `Author: ${author}.`, `Labels: ${labelSummary(issue.labels)}.`, `Created: ${issue.createdAt ?? 'unknown'}.`, `Updated: ${issue.updatedAt ?? 'unknown'}.`, `Body excerpt: ${excerpt(issue.body)}`],
    importantComments: commentSummaries(issue.comments),
    relatedIssuesOrPrs: ['Related issue/PR discovery is not implemented yet.'],
    repositoryInstructions: ['Follow AGENTS.md and CLAUDE.md.', 'Use one issue to one PR.', 'Do not add GitHub write operations.'],
    technicalSurface: ['GitHub issue metadata.', 'Issue body excerpt.', 'Limited issue comment excerpts.', 'Intake quality check.', 'Best-effort preflight.'],
    riskChecklist: ['Review preflight findings before sharing externally.', 'Treat issue body and comments as user-provided text.', 'Avoid acting on security-like claims without confirming evidence.', 'Keep any follow-up PR small and read-only unless explicitly approved.'],
    intakeQualityCheck: buildIntakeQualityCheck(issue, rawText, preflight.findings.length),
    codexTaskPrompt: 'Use this triage packet to propose the smallest safe next action. Do not write to GitHub, do not call external LLM APIs, and do not infer details not present in the packet.',
    verificationPlan: [...buildRepositoryVerificationSteps(repositoryRoot, localRepositoryConfirmed), `Re-run mck triage ${redactSensitiveText(target)} from the same repository context using the documented local CLI invocation.`, 'Review preflight findings before external sharing.', 'Confirm the proposed next action remains within v0.1 scope.'],
    handoffNotes: ['This packet is read-only and does not update the issue.', 'Only a capped body excerpt and up to three capped comment excerpts are rendered.', 'Duplicate/related search is not implemented yet.'],
    knownLimitations: ['Only one issue is collected.', 'Body and comments are excerpted, not complete.', 'Only first three comments are rendered.', 'Related issue/PR detection is not implemented.', 'Preflight is best-effort and may miss sensitive content.'],
    preflight,
  };
}

export function renderSyntheticTriagePacket(generatedAt?: string): string {
  return renderMaintainerTaskPacket(buildSyntheticTriagePacket(generatedAt));
}

export function renderIssueTriagePacket(target: string, options: TriageOptions = {}): string {
  return renderMaintainerTaskPacket(buildIssueTriagePacket(target, options));
}
