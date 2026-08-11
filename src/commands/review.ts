import { VERSION } from '../version.ts';
import { runPreflight, redactSensitiveText } from '../packet/preflight.ts';
import { renderMaintainerTaskPacket } from '../packet/renderMaintainerTaskPacket.ts';
import type { MaintainerTaskPacket } from '../packet/types.ts';
import { parseJsonObject } from '../utils/safeJson.ts';
import { runReadOnlyCommand, type ReadOnlyCommandResult, type ReadOnlyCommandRunner } from '../shell/runReadOnlyCommand.ts';
import { buildRepositoryVerificationSteps, targetMatchesLocalGitHubRepository, UNCONFIRMED_REPOSITORY_VERIFICATION } from './repositoryVerificationPlan.ts';
import { resolveGitHubSourceProvenance, sourceLabel, validateExplicitSourceTarget } from './sourceProvenance.ts';

export type ReviewOptions = { cwd?: string; generatedAt?: string; runCommand?: ReadOnlyCommandRunner };

type PrAuthor = { login?: string } | null;
type PrFile = { path?: string; additions?: number; deletions?: number };
type PrComment = { author?: PrAuthor; body?: string; createdAt?: string };
type PrReview = { author?: PrAuthor; body?: string; state?: string; submittedAt?: string };

type PullRequestView = {
  number?: number;
  title?: string;
  state?: string;
  author?: PrAuthor;
  isDraft?: boolean;
  baseRefName?: string;
  headRefName?: string;
  mergeable?: string;
  reviewDecision?: string;
  additions?: number;
  deletions?: number;
  changedFiles?: number;
  files?: PrFile[];
  comments?: PrComment[];
  commentCount?: number;
  reviews?: PrReview[];
  reviewCount?: number;
  statusCheckCount?: number;
  body?: string;
  createdAt?: string;
  updatedAt?: string;
  url?: string;
};

const PULL_REQUEST_VIEW_PROJECTION = '{number,title,state,author,isDraft,baseRefName,headRefName,mergeable,reviewDecision,additions,deletions,changedFiles,files:[(.files // [])[:20][]|{path,additions,deletions}],commentCount:((.comments // [])|length),comments:[(.comments // [])[:3][]|{author,body:((.body // "")[0:1000]),createdAt}],reviewCount:((.reviews // [])|length),reviews:[(.reviews // [])[:3][]|{author,body:((.body // "")[0:1000]),state,submittedAt}],statusCheckCount:((.statusCheckRollup // [])|length),body:((.body // "")[0:2000]),createdAt,updatedAt,url}';

function run(name: string, argv: readonly string[], runCommand: ReadOnlyCommandRunner, cwd: string): ReadOnlyCommandResult & { name: string } {
  return { ...runCommand(argv, { cwd, maxOutputChars: 10000 }), name };
}

function summarizeCommand(result: ReadOnlyCommandResult & { name: string }): string {
  if (!result.allowed) return `${result.name}: blocked by policy (${result.reason}).`;
  if (!result.ok) {
    const detail = result.error || result.stderr.trim() || `exit ${result.exitCode ?? 'unknown'}`;
    return `${result.name}: unavailable or failed (${redactSensitiveText(detail)}).`;
  }
  return `${result.name}: available.`;
}

function excerpt(text: string | undefined, maxLength = 700): string {
  const normalized = redactSensitiveText((text ?? '').replace(/\s+/g, ' ').trim());
  if (!normalized) return '(empty)';
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}… [excerpt truncated]`;
}

function summarizeFiles(files: PullRequestView['files'], changedFiles?: number): string[] {
  const list = (files ?? []).slice(0, 20);
  if (list.length === 0) return [`Changed files: ${changedFiles ?? 0}; file list was not returned.`];
  const summaries = list.map((file) => {
    const path = redactSensitiveText(file.path ?? '(unknown path)');
    const additions = typeof file.additions === 'number' ? file.additions : '?';
    const deletions = typeof file.deletions === 'number' ? file.deletions : '?';
    return `${path} (+${additions}/-${deletions})`;
  });
  if ((changedFiles ?? list.length) > list.length) summaries.push(`Additional files omitted: ${(changedFiles ?? list.length) - list.length}.`);
  return summaries;
}

function summarizeComments(comments: PullRequestView['comments']): string[] {
  const list = (comments ?? []).slice(0, 3);
  if (list.length === 0) return ['No PR comments returned.'];
  return list.map((comment, index) => {
    const author = comment.author?.login ? redactSensitiveText(comment.author.login) : 'unknown';
    const created = comment.createdAt ? ` at ${comment.createdAt}` : '';
    return `Comment ${index + 1} by ${author}${created}: ${excerpt(comment.body, 420)}`;
  });
}

function summarizeReviews(reviews: PullRequestView['reviews']): string[] {
  const list = (reviews ?? []).slice(0, 3);
  if (list.length === 0) return ['No formal PR reviews returned.'];
  return list.map((review, index) => {
    const author = review.author?.login ? redactSensitiveText(review.author.login) : 'unknown';
    const state = review.state ?? 'UNKNOWN';
    const submitted = review.submittedAt ? ` at ${review.submittedAt}` : '';
    return `Review ${index + 1} by ${author}${submitted}: ${state}; ${excerpt(review.body, 360)}`;
  });
}

function failurePreflightText(target: string, result: ReadOnlyCommandResult): string {
  return [target, result.reason, result.error, result.stderr].filter(Boolean).join('\n');
}

function buildFailurePacket(target: string, result: ReadOnlyCommandResult & { name: string }, generatedAt: string): MaintainerTaskPacket {
  const failureText = summarizeCommand(result);
  const preflight = runPreflight(failurePreflightText(target, result), generatedAt);
  const safeTarget = redactSensitiveText(target).replace(/\s+/g, ' ').trim().slice(0, 240) || 'unknown';
  return {
    kind: 'review',
    source: `pr/${safeTarget}`,
    generatedAt,
    toolVersion: VERSION,
    maintainerGoal: 'Determine why pull request context could not be collected and what prerequisite is missing.',
    nonGoals: ['Do not write to GitHub.', 'Do not submit a GitHub review.', 'Do not guess PR contents.'],
    currentContext: [failureText],
    importantComments: ['Pull request content was not collected.'],
    relatedIssuesOrPrs: ['Unknown because PR collection failed.'],
    repositoryInstructions: ['Follow AGENTS.md and CLAUDE.md.'],
    technicalSurface: ['GitHub CLI pull request view.', 'Read-only command policy.'],
    riskChecklist: ['Fix local CLI/auth/repository context before relying on this packet.', 'Do not infer PR details from a failed collection.'],
    intakeQualityCheck: ['Unavailable because PR collection failed.'],
    codexTaskPrompt: 'Do not implement from this packet. First resolve the read-only PR collection failure.',
    verificationPlan: [UNCONFIRMED_REPOSITORY_VERIFICATION, 'Run mck doctor --json using the documented local CLI invocation.', 'Re-run mck review <pr-number-or-url> after fixing prerequisites.'],
    handoffNotes: ['Collection failed without crashing the CLI.'],
    knownLimitations: ['No PR metadata, file summary, comments, or reviews were available.'],
    preflight,
  };
}

export function buildSyntheticReviewPacket(generatedAt: string = new Date().toISOString()): MaintainerTaskPacket {
  const sourceText = [
    'Synthetic pull request review demo.',
    'Pull request title: Add read-only command output for a local CLI.',
    'Changed surface: CLI routing, tests, README, and runbook.',
    'Verification: npm test and command smoke checks pass.',
    'Risk: ensure no GitHub write behavior or external network call is added.',
  ].join('\n');
  const preflight = runPreflight(sourceText, generatedAt);
  return {
    kind: 'review',
    source: 'synthetic/demo-repository#202',
    generatedAt,
    toolVersion: VERSION,
    maintainerGoal: 'Review the synthetic pull request and decide whether it is safe to merge after human review.',
    nonGoals: ['Do not submit a GitHub review.', 'Do not write a PR comment.', 'Do not call an external LLM API.', 'Do not treat this synthetic packet as real PR analysis.'],
    currentContext: ['The pull request is a synthetic public-safe example for testing review packet shape.', 'The change claims to update CLI routing, tests, README, and runbook only.', 'The expected merge path remains human-reviewed and read-only from the tool perspective.'],
    importantComments: ['No actual review comments are included in this synthetic fixture.', 'No real diff or repository code is collected by this demo.'],
    relatedIssuesOrPrs: ['Synthetic related issue: #201 add command output.', 'Synthetic related PR: #202 current review target.'],
    repositoryInstructions: ['Follow AGENTS.md and CLAUDE.md.', 'Keep one issue to one PR.', 'Do not add GitHub write operations.'],
    technicalSurface: ['CLI command routing.', 'Packet rendering.', 'Unit tests.', 'README and runbook documentation.'],
    riskChecklist: ['Changed surface is small and understandable.', 'Tests cover the new behavior.', 'Documentation matches the implemented behavior.', 'No GitHub write command is introduced.', 'No external LLM API call is introduced.', 'No package publication path is introduced.', 'Preflight limitation wording remains present.'],
    intakeQualityCheck: ['PR description: present in synthetic form.', 'Changed files summary: present in synthetic form.', 'Verification evidence: present in synthetic form.', 'Security-sensitive changes: none claimed in synthetic form.', 'Docs impact: present.'],
    codexTaskPrompt: 'Use this synthetic packet only to verify review structure and safety wording. Do not make a real merge or review decision from its synthetic claims.',
    verificationPlan: [UNCONFIRMED_REPOSITORY_VERIFICATION, 'Re-run mck review --demo using the documented local CLI invocation.', 'Confirm output includes changed surface, risk checklist, and verification plan.', 'Confirm preflight result and limitation wording are present.'],
    handoffNotes: ['This is a synthetic demo packet for validating pull-request-focused review structure.', 'Real read-only PR collection is available through mck review <pr-number-or-url>; this fixture does not exercise it.'],
    knownLimitations: ['Synthetic demo only.', 'Does not inspect actual pull request diffs or comments.', 'Does not submit GitHub reviews or comments.', 'Does not prove the packet is safe to share publicly.'],
    preflight,
  };
}

export function buildPullRequestReviewPacket(target: string, options: ReviewOptions = {}): MaintainerTaskPacket {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const cwd = options.cwd ?? process.cwd();
  const runCommand = options.runCommand ?? runReadOnlyCommand;
  const fields = 'number,title,state,author,isDraft,baseRefName,headRefName,mergeable,reviewDecision,additions,deletions,changedFiles,files,comments,reviews,statusCheckRollup,body,createdAt,updatedAt,url';
  const result = run('gh pr view', ['gh', 'pr', 'view', target, '--json', fields, '--jq', PULL_REQUEST_VIEW_PROJECTION], runCommand, cwd);
  if (!result.ok) return buildFailurePacket(target, result, generatedAt);
  if (result.truncated) {
    return buildFailurePacket(target, {
      ...result,
      ok: false,
      stderr: 'GitHub response exceeded the bounded collection limit; partial JSON was not used.',
    }, generatedAt);
  }
  const parsed = parseJsonObject<PullRequestView>(result.stdout);
  if (!parsed.ok) return buildFailurePacket(target, { ...result, ok: false, stderr: parsed.error }, generatedAt);

  const pr = parsed.value;
  const provenance = resolveGitHubSourceProvenance('pull_request', pr.url, pr.number);
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
    pr.title,
    pr.author?.login,
    pr.baseRefName,
    pr.headRefName,
    pr.body,
    ...(pr.comments ?? []).flatMap((comment) => [comment.author?.login ?? '', comment.body ?? '']),
    ...(pr.reviews ?? []).flatMap((review) => [review.author?.login ?? '', review.body ?? '']),
    ...(pr.files ?? []).map((file) => file.path ?? ''),
  ].join('\n');
  const preflight = runPreflight(rawText, generatedAt);
  const fileSummaries = summarizeFiles(pr.files, pr.changedFiles);
  const title = redactSensitiveText(pr.title ?? '(untitled)');
  const author = pr.author?.login ? redactSensitiveText(pr.author.login) : 'unknown';
  const source = sourceLabel(provenance.value);
  const localRepositoryConfirmed = gitRoot.ok
    && gitRemotes.ok
    && targetMatchesLocalGitHubRepository(pr.url, gitRemotes.stdout);
  const repositoryRoot = localRepositoryConfirmed ? gitRoot.stdout.trim() || undefined : undefined;

  return {
    kind: 'review',
    source,
    sourceProvenance: provenance.value,
    generatedAt,
    toolVersion: VERSION,
    maintainerGoal: 'Review the pull request shape, changed surface, risks, and verification plan without writing to GitHub.',
    nonGoals: ['Do not submit a GitHub review.', 'Do not write a PR comment.', 'Do not merge, close, label, or update the PR.', 'Do not call an external LLM API.', 'Do not render full diff hunks in v0.1 output.'],
    currentContext: [`Title: ${title}.`, `State: ${pr.state ?? 'unknown'}.`, `Draft: ${pr.isDraft === true ? 'yes' : 'no'}.`, `Author: ${author}.`, `Base: ${redactSensitiveText(pr.baseRefName ?? 'unknown')}.`, `Head: ${redactSensitiveText(pr.headRefName ?? 'unknown')}.`, `Review decision: ${pr.reviewDecision ?? 'unknown'}.`, `Mergeable: ${pr.mergeable ?? 'unknown'}.`, `Created: ${pr.createdAt ?? 'unknown'}.`, `Updated: ${pr.updatedAt ?? 'unknown'}.`, `Body excerpt: ${excerpt(pr.body)}`],
    importantComments: [
      `Selection note: ${pr.comments?.length ?? 0} of ${pr.commentCount ?? pr.comments?.length ?? 0} GitHub CLI-reported comment(s) and ${pr.reviews?.length ?? 0} of ${pr.reviewCount ?? pr.reviews?.length ?? 0} GitHub CLI-reported review(s) were collected in GitHub CLI order; they were not ranked by importance.`,
      ...summarizeComments(pr.comments),
      ...summarizeReviews(pr.reviews),
    ],
    relatedIssuesOrPrs: ['Closing issue/reference detection is not implemented yet.'],
    repositoryInstructions: ['Follow AGENTS.md and CLAUDE.md.', 'Use one issue to one PR.', 'Do not add GitHub write operations.'],
    technicalSurface: [`Changed files: ${pr.changedFiles ?? fileSummaries.length}.`, `Additions/deletions: +${pr.additions ?? '?'} / -${pr.deletions ?? '?'}.`, ...fileSummaries, `Status check entries reported: ${pr.statusCheckCount ?? 0}; names and conclusions are not collected in v0.1.`],
    riskChecklist: ['Review preflight findings before sharing externally.', 'Treat PR body, comments, reviews, and file paths as user-provided text.', 'Inspect the actual GitHub diff manually before merge; this packet does not include diff hunks.', 'Confirm tests/status checks in GitHub UI before merge.', 'Keep follow-up changes small and read-only unless explicitly approved.'],
    intakeQualityCheck: [`PR description excerpt: ${pr.body ? 'present' : 'missing or empty'}.`, `Changed files summary: ${fileSummaries.length > 0 ? 'present' : 'missing'}.`, `PR comments collected: ${pr.comments?.length ?? 0} of ${pr.commentCount ?? pr.comments?.length ?? 0}.`, `Formal reviews collected: ${pr.reviews?.length ?? 0} of ${pr.reviewCount ?? pr.reviews?.length ?? 0}.`, `Status check entries reported: ${pr.statusCheckCount ?? 0}; individual results require separate verification.`],
    codexTaskPrompt: 'Use this review packet to evaluate PR shape and propose a minimal safe review decision. Do not write to GitHub, do not submit a review, and do not infer details not present in the packet.',
    verificationPlan: [...buildRepositoryVerificationSteps(repositoryRoot, localRepositoryConfirmed), `Re-run mck review ${redactSensitiveText(target)} from the same repository context using the documented local CLI invocation.`, 'Inspect the actual PR diff in GitHub UI or local git before merge.', 'Review preflight findings before external sharing.', 'Confirm the proposed review decision remains within v0.1 scope.'],
    handoffNotes: ['This packet is read-only and does not update the pull request.', 'The collector bounds the body, first 20 file summaries, first three comments, and first three reviews before JSON reaches the MCK Node process; rendered excerpts are capped again.', 'Diff hunks are intentionally not rendered in this PR.'],
    knownLimitations: ['Only one PR is collected.', 'No full diff hunks are rendered.', 'Only up to 20 file summaries, three comments, and three reviews in GitHub CLI order are collected; comments and reviews are not ranked by importance.', 'Status-check count is collected, but names and conclusions are not.', 'Closing issue/reference detection is not implemented.', 'Preflight is best-effort and may miss sensitive content.'],
    preflight,
  };
}

export function renderSyntheticReviewPacket(generatedAt?: string): string {
  return renderMaintainerTaskPacket(buildSyntheticReviewPacket(generatedAt));
}

export function renderPullRequestReviewPacket(target: string, options: ReviewOptions = {}): string {
  return renderMaintainerTaskPacket(buildPullRequestReviewPacket(target, options));
}
