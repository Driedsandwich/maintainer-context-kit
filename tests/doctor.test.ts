import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDoctorReport, formatDoctorReport } from '../src/doctor.ts';
import type { ReadOnlyCommandResult, ReadOnlyCommandRunner } from '../src/shell/runReadOnlyCommand.ts';

function ok(argv: readonly string[], stdout: string): ReadOnlyCommandResult {
  return {
    argv: [...argv],
    allowed: true,
    ok: true,
    exitCode: 0,
    stdout,
    stderr: '',
    truncated: false,
    durationMs: 1,
    reason: 'test command allowed',
  };
}

function failed(
  argv: readonly string[],
  options: { exitCode?: number | null; stderr?: string; error?: string },
): ReadOnlyCommandResult {
  return {
    argv: [...argv],
    allowed: true,
    ok: false,
    exitCode: options.exitCode ?? null,
    stdout: '',
    stderr: options.stderr ?? '',
    truncated: false,
    durationMs: 1,
    reason: 'test command allowed',
    error: options.error,
  };
}

const sensitiveBranch = 'customer-acme-outage';

const fakeRunner: ReadOnlyCommandRunner = (argv) => {
  const key = argv.join(' ');
  const outputs: Record<string, string> = {
    'git version': 'git version 2.54.0\n',
    'git rev-parse --show-toplevel': '/tmp/mck\n',
    'git branch --show-current': `${sensitiveBranch}\n`,
    'git status --short': '',
    'git remote -v': 'origin\thttps://github.com/example/repo.git (fetch)\norigin\thttps://github.com/example/repo.git (push)\n',
    'gh version': 'gh version 2.99.0\n',
    'gh auth status --json hosts': '{"hosts":{"github.com":[{"active":true}]}}\n',
    'gh repo view --json nameWithOwner,isPrivate,defaultBranchRef,url': '{"nameWithOwner":"example/repo","isPrivate":true,"defaultBranchRef":{"name":"main"},"url":"https://github.com/example/repo"}\n',
  };
  return ok(argv, outputs[key] ?? '');
};

test('doctor report preserves v0.1 safety mode', () => {
  const report = buildDoctorReport({ runCommand: fakeRunner });

  assert.equal(report.project, 'maintainer-context-kit');
  assert.equal(report.cli, 'mck');
  assert.equal(report.mode.localFirst, true);
  assert.equal(report.mode.readOnlyFirst, true);
  assert.equal(report.mode.githubWritesAllowed, false);
  assert.equal(report.mode.externalLlmCallsAllowed, false);
  assert.equal(report.mode.packagePublicationAllowed, false);
});

test('doctor enforces the documented Node 24.12.0 minimum', () => {
  const below = buildDoctorReport({ nodeVersion: 'v24.11.9', runCommand: fakeRunner });
  const minimum = buildDoctorReport({ nodeVersion: 'v24.12.0', runCommand: fakeRunner });
  const newerMajor = buildDoctorReport({ nodeVersion: 'v25.0.0', runCommand: fakeRunner });

  assert.equal(below.checks.find((check) => check.name === 'node-runtime')?.status, 'warn');
  assert.equal(minimum.checks.find((check) => check.name === 'node-runtime')?.status, 'pass');
  assert.equal(newerMajor.checks.find((check) => check.name === 'node-runtime')?.status, 'pass');
});

test('doctor report includes read-only environment diagnostics', () => {
  const report = buildDoctorReport({ runCommand: fakeRunner });
  const names = report.checks.map((check) => check.name);
  const text = formatDoctorReport(report);

  assert.ok(names.includes('git-version'));
  assert.ok(names.includes('gh-auth-status'));
  assert.ok(names.includes('gh-repo-view'));
  assert.match(text, /mck doctor/);
  assert.match(text, /No GitHub write operation/);
  assert.doesNotMatch(text, /token:|password:/i);
});

test('doctor report redacts local filesystem paths', () => {
  const report = buildDoctorReport({ cwd: '/tmp/mck', runCommand: fakeRunner });
  const repositoryRoot = report.checks.find((check) => check.name === 'git-repository-root');
  const json = JSON.stringify(report);
  const text = formatDoctorReport(report);

  assert.equal(report.runtime.cwd, '<local-cwd>');
  assert.equal(repositoryRoot?.detail, 'Repository root detected: <local-repo-root>');
  assert.doesNotMatch(json, /\/tmp\/mck/);
  assert.doesNotMatch(text, /\/tmp\/mck/);
});

test('doctor report does not print current branch name', () => {
  const report = buildDoctorReport({ runCommand: fakeRunner });
  const currentBranch = report.checks.find((check) => check.name === 'git-current-branch');
  const json = JSON.stringify(report);
  const text = formatDoctorReport(report);

  assert.equal(currentBranch?.detail, 'Current branch detected; branch name is not printed.');
  assert.doesNotMatch(json, new RegExp(sensitiveBranch));
  assert.doesNotMatch(text, new RegExp(sensitiveBranch));
});

test('doctor report suppresses raw subprocess failure diagnostics', () => {
  const syntheticPath = ['', 'tmp', 'synthetic-user', 'private-repository'].join('/');
  const syntheticCredential = ['invalid', '_credential_', 'marker_', 'A'.repeat(16)].join('');
  const rawDiagnostic = [
    `failure at ${syntheticPath}`,
    `credential=${syntheticCredential}`,
    'synthetic second line',
  ].join('\n');
  const runner: ReadOnlyCommandRunner = (argv) => {
    const key = argv.join(' ');
    if (key === 'git version') {
      return failed(argv, { error: rawDiagnostic });
    }
    if (key === 'gh version') {
      return failed(argv, { exitCode: 23, stderr: rawDiagnostic });
    }
    if (key === 'git rev-parse --show-toplevel') {
      return failed(argv, {});
    }
    return fakeRunner(argv);
  };

  const report = buildDoctorReport({ runCommand: runner });
  const gitVersion = report.checks.find((check) => check.name === 'git-version');
  const repositoryRoot = report.checks.find((check) => check.name === 'git-repository-root');
  const ghVersion = report.checks.find((check) => check.name === 'gh-version');
  const text = formatDoctorReport(report);
  const json = JSON.stringify(report);

  assert.equal(gitVersion?.status, 'fail');
  assert.equal(gitVersion?.detail, 'Command could not be started; diagnostic details are suppressed.');
  assert.equal(repositoryRoot?.status, 'fail');
  assert.equal(repositoryRoot?.detail, 'Command did not complete successfully; diagnostic details are suppressed.');
  assert.equal(ghVersion?.status, 'fail');
  assert.equal(ghVersion?.detail, 'Command exited with status 23; diagnostic details are suppressed.');
  for (const output of [text, json, gitVersion?.detail ?? '', ghVersion?.detail ?? '']) {
    assert.equal(output.includes(syntheticPath), false);
    assert.equal(output.includes(syntheticCredential), false);
    assert.equal(output.includes('synthetic second line'), false);
  }
});

test('doctor report suppresses raw JSON parser diagnostics', () => {
  const syntheticPath = ['', 'tmp', 'synthetic-user', 'private-repository'].join('/');
  const syntheticCredential = ['invalid', '_credential_', 'marker_', 'B'.repeat(16)].join('');
  const malformedJson = [`{"hosts":`, syntheticPath, syntheticCredential].join('\n');
  const runner: ReadOnlyCommandRunner = (argv) => {
    const key = argv.join(' ');
    if (key === 'gh auth status --json hosts' || key === 'gh repo view --json nameWithOwner,isPrivate,defaultBranchRef,url') {
      return ok(argv, malformedJson);
    }
    return fakeRunner(argv);
  };

  const report = buildDoctorReport({ runCommand: runner });
  const auth = report.checks.find((check) => check.name === 'gh-auth-status');
  const repo = report.checks.find((check) => check.name === 'gh-repo-view');
  const text = formatDoctorReport(report);
  const json = JSON.stringify(report);

  assert.equal(auth?.status, 'warn');
  assert.equal(auth?.detail, 'gh auth status returned invalid JSON; parser details are suppressed.');
  assert.equal(repo?.status, 'warn');
  assert.equal(repo?.detail, 'gh repo view returned invalid JSON; parser details are suppressed.');
  for (const output of [text, json, auth?.detail ?? '', repo?.detail ?? '']) {
    assert.equal(output.includes(syntheticPath), false);
    assert.equal(output.includes(syntheticCredential), false);
  }
});

test('doctor CLI withholds raw failure diagnostics from text, JSON, stdout, and stderr', () => {
  const syntheticPath = ['', 'tmp', 'synthetic-user', 'private-repository'].join('/');
  const syntheticCredential = ['invalid', '_credential_', 'marker_', 'C'.repeat(16)].join('');
  const tempRoot = mkdtempSync(join(tmpdir(), 'mck-doctor-synthetic-'));
  const binDir = join(tempRoot, 'bin');
  const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
  mkdirSync(binDir);

  writeFileSync(join(binDir, 'git'), `#!/bin/sh
case "$1" in
  version) printf '%s\n' 'git version synthetic' ;;
  rev-parse) printf '%s\n' '${syntheticPath}' ;;
  branch) printf '%s\n' 'synthetic-branch' ;;
  status) printf '%s\n' '${syntheticPath}' '${syntheticCredential}' >&2; exit 23 ;;
  remote) printf '%s\n' 'origin synthetic (fetch)' 'origin synthetic (push)' ;;
esac
`, { mode: 0o700 });
  writeFileSync(join(binDir, 'gh'), `#!/bin/sh
case "$1" in
  version) printf '%s\n' 'gh version synthetic' ;;
  auth) printf '%s\n' '{"hosts":' '${syntheticCredential}' ;;
  repo) printf '%s\n' '{"nameWithOwner":' '${syntheticPath}' ;;
esac
`, { mode: 0o700 });

  try {
    for (const args of [['doctor'], ['doctor', '--json']]) {
      const result = spawnSync(process.execPath, ['src/cli.ts', ...args], {
        cwd: repositoryRoot,
        env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ''}` },
        encoding: 'utf8',
      });

      assert.equal(result.status, 0, args.join(' '));
      assert.equal(result.stderr, '', args.join(' '));
      assert.equal(result.stdout.includes(syntheticPath), false, args.join(' '));
      assert.equal(result.stdout.includes(syntheticCredential), false, args.join(' '));
      assert.match(result.stdout, /diagnostic details are suppressed|parser details are suppressed/, args.join(' '));

      if (args.includes('--json')) {
        const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
        assert.deepEqual(Object.keys(parsed), ['project', 'cli', 'version', 'mode', 'runtime', 'checks', 'limitations']);
      }
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
