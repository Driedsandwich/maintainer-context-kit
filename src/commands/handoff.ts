import { closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import { VERSION } from '../version.ts';
import { runPreflight, redactSensitiveText } from '../packet/preflight.ts';
import { renderMaintainerTaskPacket } from '../packet/renderMaintainerTaskPacket.ts';
import type { MaintainerTaskPacket } from '../packet/types.ts';
import { parseJsonArray, parseJsonObject } from '../utils/safeJson.ts';
import { runReadOnlyCommand, type ReadOnlyCommandResult, type ReadOnlyCommandRunner } from '../shell/runReadOnlyCommand.ts';
import { buildRepositoryVerificationSteps, repositoryNameMatchesLocalGitHubRepository, UNCONFIRMED_REPOSITORY_VERIFICATION } from './repositoryVerificationPlan.ts';

export type HandoffOptions = {
  cwd?: string;
  generatedAt?: string;
  runCommand?: ReadOnlyCommandRunner;
};

type RepoView = {
  nameWithOwner?: string;
  isPrivate?: boolean;
  defaultBranchRef?: { name?: string } | null;
  url?: string;
};

type IssueSummary = {
  number?: number;
  title?: string;
  updatedAt?: string;
};

type PullRequestSummary = {
  number?: number;
  title?: string;
  isDraft?: boolean;
  updatedAt?: string;
};

const MAX_INSTRUCTION_BYTES = 64 * 1024;
const UNSAFE_INSTRUCTION_SUMMARY = 'was skipped because it is not a safe bounded regular file.';

type InstructionReadResult =
  | { status: 'missing' | 'unsafe' }
  | { status: 'ok'; content: string };

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
    ...runCommand(argv, { cwd, maxOutputChars: 6000 }),
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

function summarizeGitStatus(stdout: string): string {
  const count = stdout.trim().split('\n').filter(Boolean).length;
  return count === 0 ? 'Working tree appears clean.' : `Working tree has ${count} changed path(s).`;
}

function summarizeGitBranch(result: ReadOnlyCommandResult & { name: string; command: string }): string {
  if (!result.ok) {
    return summarizeCommand(result);
  }
  return result.stdout.trim()
    ? 'Current branch detected; branch name is not printed.'
    : 'No current branch detected; repository may be in detached HEAD.';
}

function gitRemoteNames(stdout: string): string[] {
  return [...new Set(stdout.trim().split('\n').map((line) => line.split(/\s+/)[0]).filter(Boolean))].sort();
}

function summarizeGitRemotes(stdout: string): string {
  const names = gitRemoteNames(stdout);
  if (names.length === 0) {
    return 'No git remote names detected.';
  }
  return `Git remote name(s): ${names.map(redactSensitiveText).join(', ')}. Remote URLs are intentionally not printed.`;
}

function isWithinRepositoryRoot(repositoryRoot: string, resolvedPath: string): boolean {
  const pathFromRoot = relative(repositoryRoot, resolvedPath);
  return pathFromRoot === ''
    || (pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${sep}`) && !isAbsolute(pathFromRoot));
}

function readInstructionFile(repositoryRoot: string, relativePath: string): InstructionReadResult {
  const candidatePath = join(repositoryRoot, relativePath);
  try {
    const entry = lstatSync(candidatePath);
    if (entry.isSymbolicLink() || !entry.isFile()) {
      return { status: 'unsafe' };
    }

    const resolvedPath = realpathSync(candidatePath);
    if (!isWithinRepositoryRoot(repositoryRoot, resolvedPath)) {
      return { status: 'unsafe' };
    }

    const descriptor = openSync(resolvedPath, 'r');
    try {
      const opened = fstatSync(descriptor);
      if (!opened.isFile() || opened.size > MAX_INSTRUCTION_BYTES) {
        return { status: 'unsafe' };
      }

      const buffer = Buffer.alloc(MAX_INSTRUCTION_BYTES + 1);
      let bytesRead = 0;
      while (bytesRead < buffer.length) {
        const read = readSync(
          descriptor,
          buffer,
          bytesRead,
          buffer.length - bytesRead,
          bytesRead,
        );
        if (read === 0) {
          break;
        }
        bytesRead += read;
      }
      if (bytesRead > MAX_INSTRUCTION_BYTES) {
        return { status: 'unsafe' };
      }
      return { status: 'ok', content: buffer.subarray(0, bytesRead).toString('utf8') };
    } finally {
      closeSync(descriptor);
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return { status: 'missing' };
    }
    return { status: 'unsafe' };
  }
}

function collectInstructionSummaries(cwd: string): { summaries: string[]; rawHeadings: string[] } {
  const candidates = ['AGENTS.md', 'CLAUDE.md', '.cursor/rules', '.cursorrules'];
  const summaries: string[] = [];
  const rawHeadings: string[] = [];
  let repositoryRoot: string;
  try {
    repositoryRoot = realpathSync(cwd);
  } catch {
    return {
      summaries: ['Repository instruction files were not inspected because the repository root could not be verified.'],
      rawHeadings,
    };
  }
  for (const relative of candidates) {
    const result = readInstructionFile(repositoryRoot, relative);
    if (result.status === 'missing') {
      continue;
    }
    if (result.status === 'unsafe') {
      summaries.push(`${relative} ${UNSAFE_INSTRUCTION_SUMMARY}`);
      continue;
    }
    const content = result.content;
    const firstHeading = content.split('\n').find((line) => line.trim().startsWith('#'))?.trim();
    if (firstHeading) {
      rawHeadings.push(firstHeading);
    }
    summaries.push(`${relative} found (${content.length} chars)${firstHeading ? `; first heading: ${redactSensitiveText(firstHeading)}` : ''}.`);
  }
  return {
    summaries: summaries.length > 0 ? summaries : ['No repository instruction files found in the current working directory.'],
    rawHeadings,
  };
}

function failurePreflightText(result: ReadOnlyCommandResult): string {
  return result.ok ? '' : [result.reason, result.error, result.stderr].filter(Boolean).join('\n');
}

function repoViewContext(stdout: string): { source: string; context: string[]; raw: string } {
  const parsed = parseJsonObject<RepoView>(stdout);
  if (!parsed.ok) {
    return {
      source: 'local/repository',
      context: [`Could not parse gh repo metadata: ${parsed.error}`],
      raw: stdout,
    };
  }

  const repo = redactSensitiveText(parsed.value.nameWithOwner ?? 'local/repository');
  const branch = redactSensitiveText(parsed.value.defaultBranchRef?.name ?? 'unknown');
  const visibility = parsed.value.isPrivate === true ? 'private' : 'public-or-unknown';

  return {
    source: repo,
    context: [`GitHub repository: ${repo}.`, `Default branch: ${branch}.`, `Visibility: ${visibility}.`],
    raw: stdout,
  };
}

function issueSummaries(stdout: string): { summaries: string[]; raw: string } {
  const parsed = parseJsonArray<IssueSummary>(stdout);
  if (!parsed.ok) {
    return { summaries: [`Could not parse open issue list: ${parsed.error}`], raw: stdout };
  }
  if (parsed.value.length === 0) {
    return { summaries: ['No open issues returned by GitHub CLI.'], raw: stdout };
  }
  return {
    summaries: parsed.value.map((issue) => `#${issue.number ?? '?'} ${redactSensitiveText(issue.title ?? '(untitled)')}${issue.updatedAt ? ` — updated ${issue.updatedAt}` : ''}`),
    raw: stdout,
  };
}

function prSummaries(stdout: string): { summaries: string[]; raw: string } {
  const parsed = parseJsonArray<PullRequestSummary>(stdout);
  if (!parsed.ok) {
    return { summaries: [`Could not parse open pull request list: ${parsed.error}`], raw: stdout };
  }
  if (parsed.value.length === 0) {
    return { summaries: ['No open pull requests returned by GitHub CLI.'], raw: stdout };
  }
  return {
    summaries: parsed.value.map((pr) => `#${pr.number ?? '?'} ${redactSensitiveText(pr.title ?? '(untitled)')}${pr.isDraft ? ' [draft]' : ''}${pr.updatedAt ? ` — updated ${pr.updatedAt}` : ''}`),
    raw: stdout,
  };
}

export function buildSyntheticHandoffPacket(generatedAt: string = new Date().toISOString()): MaintainerTaskPacket {
  const sourceText = [
    'Synthetic maintainer handoff demo.',
    'Repository status: planning complete, CLI scaffold complete, doctor diagnostics complete, packet renderer complete.',
    'Next action: implement real read-only repository collection after demo command is validated.',
  ].join('\n');

  const preflight = runPreflight(sourceText, generatedAt);

  return {
    kind: 'handoff',
    source: 'synthetic/demo-repository',
    generatedAt,
    toolVersion: VERSION,
    maintainerGoal: 'Resume the project with enough context to choose the next small implementation step.',
    nonGoals: [
      'Do not write to GitHub.',
      'Do not call an external LLM API.',
      'Do not treat this synthetic packet as real repository analysis.',
    ],
    currentContext: [
      'The project is a local-first, read-only CLI for Maintainer Task Packets.',
      'The CLI scaffold and doctor diagnostics exist.',
      'The internal packet renderer and best-effort preflight exist.',
      'This demo uses synthetic public-safe content only.',
    ],
    importantComments: [
      'Real GitHub issue, PR, release, and repository collection is intentionally not implemented in this demo.',
      'The next implementation should keep one issue to one PR and maintain the read-only boundary.',
    ],
    relatedIssuesOrPrs: [
      'Synthetic reference: PR0 established the project ledger.',
      'Synthetic reference: PR1 introduced the CLI scaffold.',
      'Synthetic reference: PR2 expanded doctor diagnostics.',
      'Synthetic reference: PR3 introduced packet rendering and preflight.',
    ],
    repositoryInstructions: [
      'Follow AGENTS.md and CLAUDE.md.',
      'Use synthetic fixtures only until real read-only collection is implemented safely.',
      'Keep examples public-safe.',
    ],
    technicalSurface: [
      'CLI command routing.',
      'Maintainer Task Packet renderer.',
      'Best-effort secret/PII preflight.',
      'Read-only command policy.',
    ],
    riskChecklist: [
      'Confirm no GitHub write command is added.',
      'Confirm no external LLM API call is added.',
      'Confirm demo content remains synthetic.',
      'Confirm preflight limitation wording is present.',
    ],
    intakeQualityCheck: [
      'Not applicable to repository-level handoff demo.',
      'Future issue-level packets should check reproduction steps, expected behavior, actual behavior, environment, specificity, and security claims.',
    ],
    codexTaskPrompt: 'Implement the next small read-only feature using one issue and one PR. Preserve local-first behavior, do not write to GitHub, and do not call external LLM APIs.',
    verificationPlan: [
      UNCONFIRMED_REPOSITORY_VERIFICATION,
      'Re-run mck handoff --demo using the documented local CLI invocation.',
      'Confirm output is a Maintainer Task Packet.',
      'Confirm preflight result and limitation wording are present.',
    ],
    handoffNotes: [
      'This is a synthetic demo packet for validating rendering and CLI flow.',
      'The next real feature should collect repository context through read-only adapters.',
    ],
    knownLimitations: [
      'Synthetic demo only.',
      'Does not inspect actual GitHub issues, pull requests, releases, or repository files.',
      'Does not prove the packet is safe to share publicly.',
    ],
    preflight,
  };
}

export function buildRepositoryHandoffPacket(options: HandoffOptions = {}): MaintainerTaskPacket {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const cwd = options.cwd ?? process.cwd();
  const runCommand = options.runCommand ?? runReadOnlyCommand;

  const gitRoot = run('git root', ['git', 'rev-parse', '--show-toplevel'], runCommand, cwd);
  const gitBranch = run('git branch', ['git', 'branch', '--show-current'], runCommand, cwd);
  const gitStatus = run('git status', ['git', 'status', '--short'], runCommand, cwd);
  const gitRemotes = run('git remotes', ['git', 'remote', '-v'], runCommand, cwd);
  const ghRepo = run('gh repo view', ['gh', 'repo', 'view', '--json', 'nameWithOwner,isPrivate,defaultBranchRef,url'], runCommand, cwd);
  const ghIssues = run('gh issue list', ['gh', 'issue', 'list', '--state', 'open', '--limit', '10', '--json', 'number,title,updatedAt'], runCommand, cwd);
  const ghPrs = run('gh pr list', ['gh', 'pr', 'list', '--state', 'open', '--limit', '10', '--json', 'number,title,isDraft,updatedAt'], runCommand, cwd);

  const repoInfo = ghRepo.ok ? repoViewContext(ghRepo.stdout) : { source: 'local/repository', context: [summarizeCommand(ghRepo)], raw: ghRepo.stdout };
  const issueInfo = ghIssues.ok ? issueSummaries(ghIssues.stdout) : { summaries: [summarizeCommand(ghIssues)], raw: ghIssues.stdout };
  const prInfo = ghPrs.ok ? prSummaries(ghPrs.stdout) : { summaries: [summarizeCommand(ghPrs)], raw: ghPrs.stdout };
  const instructionInfo = collectInstructionSummaries(gitRoot.ok && gitRoot.stdout.trim() ? gitRoot.stdout.trim() : cwd);

  const rawForPreflight = [
    gitRoot.stdout,
    gitBranch.stdout,
    gitStatus.stdout,
    ghRepo.stdout,
    ghIssues.stdout,
    ghPrs.stdout,
    gitRemoteNames(gitRemotes.stdout).join('\n'),
    instructionInfo.rawHeadings.join('\n'),
    ...[gitRoot, gitBranch, gitStatus, gitRemotes, ghRepo, ghIssues, ghPrs].map(failurePreflightText),
  ].join('\n');

  const preflight = runPreflight(rawForPreflight, generatedAt);

  const currentContext = [
    ...repoInfo.context,
    summarizeCommand(gitRoot),
    summarizeGitBranch(gitBranch),
    gitStatus.ok ? summarizeGitStatus(gitStatus.stdout) : summarizeCommand(gitStatus),
    gitRemotes.ok ? summarizeGitRemotes(gitRemotes.stdout) : summarizeCommand(gitRemotes),
  ];
  const parsedRepo = ghRepo.ok ? parseJsonObject<RepoView>(ghRepo.stdout) : { ok: false as const };
  const localRepositoryConfirmed = gitRoot.ok
    && gitRemotes.ok
    && parsedRepo.ok
    && repositoryNameMatchesLocalGitHubRepository(parsedRepo.value.nameWithOwner, gitRemotes.stdout);
  const repositoryRoot = localRepositoryConfirmed ? gitRoot.stdout.trim() || undefined : undefined;

  return {
    kind: 'handoff',
    source: repoInfo.source,
    generatedAt,
    toolVersion: VERSION,
    maintainerGoal: 'Resume repository maintenance with read-only context and choose the next small action.',
    nonGoals: [
      'Do not write to GitHub.',
      'Do not call an external LLM API.',
      'Do not treat this packet as a complete repository audit.',
    ],
    currentContext,
    importantComments: [
      'This packet was generated from read-only local git and GitHub CLI checks.',
      'Open issue and pull request summaries are limited to the first 10 items returned by GitHub CLI.',
      'Remote URLs are intentionally not printed.',
    ],
    relatedIssuesOrPrs: [...issueInfo.summaries, ...prInfo.summaries],
    repositoryInstructions: instructionInfo.summaries,
    technicalSurface: [
      'Local git metadata.',
      'GitHub repository metadata from gh repo view.',
      'Open issue summaries from gh issue list.',
      'Open pull request summaries from gh pr list.',
      'Repository instruction file presence.',
    ],
    riskChecklist: [
      'Confirm no GitHub write command was added.',
      'Confirm no external LLM API call was added.',
      'Review preflight warnings before sharing the packet externally.',
      'Treat open issue and PR titles as user-provided text.',
    ],
    intakeQualityCheck: [
      'Not applicable to repository-level handoff.',
      'Use triage packets for issue-level intake quality checks.',
    ],
    codexTaskPrompt: 'Use this handoff packet to propose the next small implementation step. Do not write to GitHub, do not call external LLM APIs, and preserve the read-only boundary.',
    verificationPlan: [
      ...buildRepositoryVerificationSteps(repositoryRoot, localRepositoryConfirmed),
      'Re-run mck handoff from the same repository context using the documented local CLI invocation.',
      'Run mck doctor --json using the documented local CLI invocation.',
      'Review preflight findings before external sharing.',
    ],
    handoffNotes: [
      'This is a minimal read-only repository handoff packet.',
      'Future PRs can enrich this with release and instruction-file excerpts after additional masking rules are tested.',
    ],
    knownLimitations: [
      'Only the first 10 open issues and first 10 open pull requests are summarized.',
      'Issue and PR comments are not collected yet.',
      'Release readiness is not collected yet.',
      'Preflight is best-effort and may miss sensitive content.',
    ],
    preflight,
  };
}

export function renderSyntheticHandoffPacket(generatedAt?: string): string {
  return renderMaintainerTaskPacket(buildSyntheticHandoffPacket(generatedAt));
}

export function renderRepositoryHandoffPacket(options: HandoffOptions = {}): string {
  return renderMaintainerTaskPacket(buildRepositoryHandoffPacket(options));
}
