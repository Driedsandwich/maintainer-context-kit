import { VERSION } from './version.ts';
import {
  runReadOnlyCommand,
  type ReadOnlyCommandResult,
  type ReadOnlyCommandRunner,
} from './shell/runReadOnlyCommand.ts';
import { parseJsonObject } from './utils/safeJson.ts';

export type DoctorStatus = 'pass' | 'warn' | 'fail';

export type DoctorCheck = {
  name: string;
  status: DoctorStatus;
  detail: string;
  command?: string;
};

export type DoctorReport = {
  project: string;
  cli: string;
  version: string;
  mode: {
    localFirst: boolean;
    readOnlyFirst: boolean;
    githubWritesAllowed: boolean;
    externalLlmCallsAllowed: boolean;
    packagePublicationAllowed: boolean;
  };
  runtime: {
    node: string;
    platform: string;
    arch: string;
    cwd: string;
  };
  checks: DoctorCheck[];
  limitations: string[];
};

export type DoctorOptions = {
  cwd?: string;
  runCommand?: ReadOnlyCommandRunner;
};

type GhRepoView = {
  nameWithOwner?: string;
  isPrivate?: boolean;
  url?: string;
  defaultBranchRef?: { name?: string } | null;
};

function getNodeMajor(version: string): number {
  const match = /^v?(\d+)/.exec(version);
  return match ? Number(match[1]) : 0;
}

function commandText(argv: readonly string[]): string {
  return argv.join(' ');
}

function summarizeCommandFailure(result: ReadOnlyCommandResult): string {
  if (result.error) {
    return 'Command could not be started; diagnostic details are suppressed.';
  }
  if (result.exitCode !== null) {
    return `Command exited with status ${result.exitCode}; diagnostic details are suppressed.`;
  }
  return 'Command did not complete successfully; diagnostic details are suppressed.';
}

function checkCommand(
  name: string,
  argv: readonly string[],
  runCommand: ReadOnlyCommandRunner,
  summarize: (stdout: string, stderr: string) => { status: DoctorStatus; detail: string },
  options: DoctorOptions,
): DoctorCheck {
  const result = runCommand(argv, { cwd: options.cwd, maxOutputChars: 4000 });
  const command = commandText(argv);

  if (!result.allowed) {
    return {
      name,
      status: 'fail',
      command,
      detail: `Command was blocked by policy: ${result.reason}`,
    };
  }

  if (!result.ok) {
    return {
      name,
      status: 'fail',
      command,
      detail: summarizeCommandFailure(result),
    };
  }

  return { name, command, ...summarize(result.stdout, result.stderr) };
}

function summarizeGitStatus(stdout: string): { status: DoctorStatus; detail: string } {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return { status: 'pass', detail: 'Working tree appears clean.' };
  }
  const changed = trimmed.split('\n').filter(Boolean).length;
  return { status: 'warn', detail: `Working tree has ${changed} changed path(s).` };
}

function summarizeGitRemote(stdout: string): { status: DoctorStatus; detail: string } {
  const lines = stdout.trim().split('\n').filter(Boolean);
  const names = new Set(lines.map((line) => line.split(/\s+/)[0]).filter(Boolean));
  if (names.size === 0) {
    return { status: 'warn', detail: 'No git remotes found.' };
  }
  return {
    status: names.has('origin') ? 'pass' : 'warn',
    detail: `Detected ${names.size} remote name(s): ${[...names].sort().join(', ')}. URLs are not printed.`,
  };
}

function summarizeGhAuth(stdout: string): { status: DoctorStatus; detail: string } {
  const parsed = parseJsonObject<{ hosts?: Record<string, unknown> }>(stdout);
  if (!parsed.ok) {
    return { status: 'warn', detail: 'gh auth status returned invalid JSON; parser details are suppressed.' };
  }
  const hosts = parsed.value.hosts ?? {};
  const hostCount = Object.keys(hosts).length;
  if (hostCount === 0) {
    return { status: 'warn', detail: 'gh auth status returned no known hosts.' };
  }
  return {
    status: 'pass',
    detail: `gh auth status returned ${hostCount} host(s). Tokens are not requested or printed.`,
  };
}

function summarizeGhRepoView(stdout: string): { status: DoctorStatus; detail: string } {
  const parsed = parseJsonObject<GhRepoView>(stdout);
  if (!parsed.ok) {
    return { status: 'warn', detail: 'gh repo view returned invalid JSON; parser details are suppressed.' };
  }

  const repo = parsed.value.nameWithOwner ?? 'unknown repository';
  const branch = parsed.value.defaultBranchRef?.name ?? 'unknown default branch';
  const visibility = parsed.value.isPrivate === true ? 'private' : 'public-or-unknown';

  return {
    status: parsed.value.nameWithOwner ? 'pass' : 'warn',
    detail: `Repository: ${repo}; default branch: ${branch}; visibility: ${visibility}.`,
  };
}

function summarizeGitRepositoryRoot(stdout: string): { status: DoctorStatus; detail: string } {
  return {
    status: 'pass',
    detail: stdout.trim() ? 'Repository root detected: <local-repo-root>' : 'Repository root detected: (empty)',
  };
}

function summarizeGitCurrentBranch(stdout: string): { status: DoctorStatus; detail: string } {
  return stdout.trim()
    ? { status: 'pass', detail: 'Current branch detected; branch name is not printed.' }
    : { status: 'warn', detail: 'No current branch detected; repository may be in detached HEAD.' };
}

export function buildDoctorReport(options: DoctorOptions = {}): DoctorReport {
  const nodeMajor = getNodeMajor(process.version);
  const supportsNativeTypeStripping = nodeMajor >= 24;
  const runCommand = options.runCommand ?? runReadOnlyCommand;

  const checks: DoctorCheck[] = [
    {
      name: 'node-runtime',
      status: supportsNativeTypeStripping ? 'pass' : 'warn',
      detail: supportsNativeTypeStripping
        ? 'Node runtime is expected to support native TypeScript type stripping for this scaffold.'
        : 'Node runtime may not support native TypeScript type stripping. Use Node 24.12.0 or newer for this scaffold.',
    },
    {
      name: 'github-write-scope',
      status: 'pass',
      detail: 'Product implementation scope is read-only for v0.1.',
    },
    {
      name: 'external-llm-scope',
      status: 'pass',
      detail: 'No external LLM API calls are part of v0.1.',
    },
    {
      name: 'package-publication',
      status: 'pass',
      detail: 'Package publication is disabled for this private bootstrap scaffold.',
    },
    checkCommand(
      'git-version',
      ['git', 'version'],
      runCommand,
      (stdout) => ({ status: 'pass', detail: stdout.trim() || 'git version returned empty output.' }),
      options,
    ),
    checkCommand(
      'git-repository-root',
      ['git', 'rev-parse', '--show-toplevel'],
      runCommand,
      summarizeGitRepositoryRoot,
      options,
    ),
    checkCommand(
      'git-current-branch',
      ['git', 'branch', '--show-current'],
      runCommand,
      summarizeGitCurrentBranch,
      options,
    ),
    checkCommand(
      'git-working-tree',
      ['git', 'status', '--short'],
      runCommand,
      summarizeGitStatus,
      options,
    ),
    checkCommand(
      'git-remotes',
      ['git', 'remote', '-v'],
      runCommand,
      summarizeGitRemote,
      options,
    ),
    checkCommand(
      'gh-version',
      ['gh', 'version'],
      runCommand,
      (stdout) => ({ status: 'pass', detail: stdout.split('\n')[0]?.trim() || 'gh version returned empty output.' }),
      options,
    ),
    checkCommand(
      'gh-auth-status',
      ['gh', 'auth', 'status', '--json', 'hosts'],
      runCommand,
      summarizeGhAuth,
      options,
    ),
    checkCommand(
      'gh-repo-view',
      ['gh', 'repo', 'view', '--json', 'nameWithOwner,isPrivate,defaultBranchRef,url'],
      runCommand,
      summarizeGhRepoView,
      options,
    ),
  ];

  return {
    project: 'maintainer-context-kit',
    cli: 'mck',
    version: VERSION,
    mode: {
      localFirst: true,
      readOnlyFirst: true,
      githubWritesAllowed: false,
      externalLlmCallsAllowed: false,
      packagePublicationAllowed: false,
    },
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cwd: '<local-cwd>',
    },
    checks,
    limitations: [
      'This doctor command is a read-only environment diagnostic; it does not generate Maintainer Task Packets yet.',
      'Native TypeScript execution relies on erasable TypeScript syntax only; no compile-time type checking is performed by Node type stripping.',
      'gh and git checks depend on the local environment and may warn or fail without stopping the CLI.',
      'No GitHub write operation or external LLM API call is performed by doctor.',
    ],
  };
}

export function formatDoctorReport(report: DoctorReport): string {
  const checks = report.checks
    .map((check) => {
      const command = check.command ? ` (${check.command})` : '';
      return `- ${check.name}${command}: ${check.status.toUpperCase()} - ${check.detail}`;
    })
    .join('\n');
  const limitations = report.limitations.map((item) => `- ${item}`).join('\n');

  return [
    'mck doctor',
    '',
    `Project: ${report.project}`,
    `Version: ${report.version}`,
    `Node: ${report.runtime.node}`,
    `Mode: local-first / read-only / no external LLM calls`,
    '',
    'Checks:',
    checks,
    '',
    'Limitations:',
    limitations,
  ].join('\n');
}
