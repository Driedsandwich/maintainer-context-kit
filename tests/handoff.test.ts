import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRepositoryHandoffPacket, buildSyntheticHandoffPacket, renderRepositoryHandoffPacket, renderSyntheticHandoffPacket } from '../src/commands/handoff.ts';
import { MAX_PACKAGE_JSON_BYTES, UNCONFIRMED_REPOSITORY_VERIFICATION } from '../src/commands/repositoryVerificationPlan.ts';
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

function fail(argv: readonly string[], stderr: string): ReadOnlyCommandResult {
  return {
    argv: [...argv],
    allowed: true,
    ok: false,
    exitCode: 1,
    stdout: '',
    stderr,
    truncated: false,
    durationMs: 1,
    reason: 'test command allowed',
  };
}

function fixtureDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mck-fixture-'));
  mkdirSync(join(dir, '.cursor'));
  writeFileSync(join(dir, 'AGENTS.md'), '# Agent instructions\n\nUse read-only operations only.\n', 'utf8');
  writeFileSync(join(dir, '.cursor', 'rules'), '# Cursor rules\n\nSynthetic fixture only.\n', 'utf8');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { check: 'node check.mjs', 'test:e2e': 'node e2e.mjs' } }), 'utf8');
  writeFileSync(join(dir, 'package-lock.json'), '{}', 'utf8');
  return dir;
}

function fakeRunner(repoRoot: string, remoteName = 'origin', branchName = 'main'): ReadOnlyCommandRunner {
  return (argv) => {
    const key = argv.join(' ');
    const outputs: Record<string, string> = {
      'git rev-parse --show-toplevel': `${repoRoot}\n`,
      'git branch --show-current': branchName ? `${branchName}\n` : '',
      'git status --short': '',
      'git remote -v': `${remoteName}\thttps://github.com/example/repo.git (fetch)\n${remoteName}\thttps://github.com/example/repo.git (push)\n`,
      'gh repo view --json nameWithOwner,isPrivate,defaultBranchRef,url': '{"nameWithOwner":"example/repo","isPrivate":true,"defaultBranchRef":{"name":"main"},"url":"https://github.com/example/repo"}\n',
      'gh issue list --state open --limit 10 --json number,title,updatedAt': '[{"number":1,"title":"Synthetic bug report","updatedAt":"2026-07-02T00:00:00Z"}]\n',
      'gh pr list --state open --limit 10 --json number,title,isDraft,updatedAt': '[{"number":2,"title":"Synthetic PR","isDraft":false,"updatedAt":"2026-07-02T00:00:00Z"}]\n',
    };
    return outputs[key] !== undefined ? ok(argv, outputs[key]) : fail(argv, 'not found');
  };
}

test('synthetic handoff packet uses public-safe demo source', () => {
  const packet = buildSyntheticHandoffPacket('2026-07-02T00:00:00.000Z');

  assert.equal(packet.kind, 'handoff');
  assert.equal(packet.source, 'synthetic/demo-repository');
  assert.equal(packet.preflight.status, 'pass');
  assert.ok(packet.knownLimitations.some((item) => item.includes('Synthetic demo')));
});

test('synthetic handoff rendering includes required sections', () => {
  const markdown = renderSyntheticHandoffPacket('2026-07-02T00:00:00.000Z');

  assert.match(markdown, /# Maintainer Task Packet: handoff - synthetic\/demo-repository/);
  assert.match(markdown, /## 1\. Maintainer Goal/);
  assert.match(markdown, /## 10\. Secret\/PII Preflight Result/);
  assert.match(markdown, /## 15\. Known Limitations/);
  assert.match(markdown, /This preflight is best-effort/);
  assert.match(markdown, /Preflight: pass/);
});

test('repository handoff packet summarizes read-only repo context', () => {
  const cwd = fixtureDir();
  const packet = buildRepositoryHandoffPacket({ cwd, generatedAt: '2026-07-02T00:00:00.000Z', runCommand: fakeRunner(cwd) });

  assert.equal(packet.kind, 'handoff');
  assert.equal(packet.source, 'example/repo');
  assert.equal(packet.preflight.status, 'pass');
  assert.ok(packet.currentContext.some((item) => item.includes('GitHub repository: example/repo')));
  assert.ok(packet.relatedIssuesOrPrs.some((item) => item.includes('#1 Synthetic bug report')));
  assert.ok(packet.relatedIssuesOrPrs.some((item) => item.includes('#2 Synthetic PR')));
  assert.ok(packet.repositoryInstructions.some((item) => item.includes('AGENTS.md found')));
  assert.ok(packet.verificationPlan.includes('Repository metadata declares common npm verification scripts. Inspect package.json and repository documentation before deciding which commands to run.'));
  assert.equal(packet.verificationPlan.some((item) => item.startsWith('Run npm ')), false);
});

test('repository handoff falls back for oversized package metadata', () => {
  const cwd = fixtureDir();
  const oversizedManifest = `{"scripts":{"test":"node --test"},"padding":"${'x'.repeat(MAX_PACKAGE_JSON_BYTES)}"}`;
  writeFileSync(join(cwd, 'package.json'), oversizedManifest, 'utf8');

  const packet = buildRepositoryHandoffPacket({ cwd, runCommand: fakeRunner(cwd) });

  assert.ok(packet.verificationPlan.includes(UNCONFIRMED_REPOSITORY_VERIFICATION));
  assert.equal(packet.verificationPlan.some((item) => item.startsWith('Run npm ')), false);
});

test('repository handoff skips symlinked instruction files and preserves regular summaries', (t) => {
  const workspace = mkdtempSync(join(tmpdir(), 'mck-instruction-symlink-'));
  const repository = join(workspace, 'repository');
  const outside = join(workspace, 'outside.md');
  mkdirSync(repository);
  writeFileSync(outside, '# Synthetic outside heading\n', 'utf8');
  writeFileSync(join(repository, 'CLAUDE.md'), '# Synthetic in-repository heading\n', 'utf8');
  symlinkSync(outside, join(repository, 'AGENTS.md'));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));

  const packet = buildRepositoryHandoffPacket({ cwd: repository, runCommand: fakeRunner(repository) });

  assert.ok(packet.repositoryInstructions.includes('AGENTS.md was skipped because it is not a safe bounded regular file.'));
  assert.ok(packet.repositoryInstructions.some((item) => item.includes('CLAUDE.md found')));
  assert.equal(packet.repositoryInstructions.some((item) => item.includes('Synthetic outside heading')), false);
  assert.equal(packet.repositoryInstructions.some((item) => item.includes(workspace)), false);
});

test('repository handoff rejects instruction files resolved outside the repository', (t) => {
  const workspace = mkdtempSync(join(tmpdir(), 'mck-instruction-containment-'));
  const repository = join(workspace, 'repository');
  const outsideDirectory = join(workspace, 'outside-cursor');
  mkdirSync(repository);
  mkdirSync(outsideDirectory);
  writeFileSync(join(outsideDirectory, 'rules'), '# Synthetic outside cursor heading\n', 'utf8');
  symlinkSync(outsideDirectory, join(repository, '.cursor'));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));

  const packet = buildRepositoryHandoffPacket({ cwd: repository, runCommand: fakeRunner(repository) });

  assert.ok(packet.repositoryInstructions.includes('.cursor/rules was skipped because it is not a safe bounded regular file.'));
  assert.equal(packet.repositoryInstructions.some((item) => item.includes('Synthetic outside cursor heading')), false);
  assert.equal(packet.repositoryInstructions.some((item) => item.includes(workspace)), false);
});

test('repository handoff skips directories and oversized instruction files without filesystem details', (t) => {
  const workspace = mkdtempSync(join(tmpdir(), 'mck-instruction-bounds-'));
  const repository = join(workspace, 'repository');
  mkdirSync(repository);
  mkdirSync(join(repository, 'AGENTS.md'));
  writeFileSync(join(repository, 'CLAUDE.md'), Buffer.alloc((64 * 1024) + 1, 0x61));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));

  let packet: ReturnType<typeof buildRepositoryHandoffPacket> | undefined;
  assert.doesNotThrow(() => {
    packet = buildRepositoryHandoffPacket({ cwd: repository, runCommand: fakeRunner(repository) });
  });

  assert.ok(packet?.repositoryInstructions.includes('AGENTS.md was skipped because it is not a safe bounded regular file.'));
  assert.ok(packet?.repositoryInstructions.includes('CLAUDE.md was skipped because it is not a safe bounded regular file.'));
  assert.equal(packet?.repositoryInstructions.some((item) => item.includes(workspace)), false);
});

test('repository handoff reports an unverifiable instruction root without path details', (t) => {
  const workspace = mkdtempSync(join(tmpdir(), 'mck-instruction-root-'));
  const repository = join(workspace, 'repository');
  const missingRoot = join(workspace, 'missing-root');
  mkdirSync(repository);
  t.after(() => rmSync(workspace, { recursive: true, force: true }));

  const baseRunner = fakeRunner(repository);
  const runner: ReadOnlyCommandRunner = (argv) => argv.join(' ') === 'git rev-parse --show-toplevel'
    ? ok(argv, `${missingRoot}\n`)
    : baseRunner(argv);
  const packet = buildRepositoryHandoffPacket({ cwd: repository, runCommand: runner });

  assert.deepEqual(packet.repositoryInstructions, [
    'Repository instruction files were not inspected because the repository root could not be verified.',
  ]);
  assert.equal(packet.repositoryInstructions.some((item) => item.includes(workspace)), false);
});

test('repository handoff does not reuse verification commands when GitHub context differs from the local remote', () => {
  const cwd = fixtureDir();
  const baseRunner = fakeRunner(cwd);
  const runner: ReadOnlyCommandRunner = (argv) => {
    if (argv.join(' ') === 'gh repo view --json nameWithOwner,isPrivate,defaultBranchRef,url') {
      return ok(argv, '{"nameWithOwner":"example/other","isPrivate":false,"defaultBranchRef":{"name":"main"},"url":"https://github.com/example/other"}\n');
    }
    return baseRunner(argv);
  };

  const packet = buildRepositoryHandoffPacket({ cwd, runCommand: runner });

  assert.ok(packet.verificationPlan.includes('Use the target repository\'s documented verification commands; no local command was assumed.'));
  assert.equal(packet.verificationPlan.some((item) => item.startsWith('Run npm ')), false);
});

test('repository handoff reports branch state without rendering the raw branch name', () => {
  const cwd = fixtureDir();
  const syntheticBranch = 'customer-acme/security-incident';
  const options = { cwd, generatedAt: '2026-07-02T00:00:00.000Z', runCommand: fakeRunner(cwd, 'origin', syntheticBranch) };
  const packet = buildRepositoryHandoffPacket(options);
  const markdown = renderRepositoryHandoffPacket(options);
  const detachedPacket = buildRepositoryHandoffPacket({
    ...options,
    runCommand: fakeRunner(cwd, 'origin', ''),
  });

  assert.ok(packet.currentContext.includes('Current branch detected; branch name is not printed.'));
  assert.equal(markdown.includes(syntheticBranch), false);
  assert.ok(detachedPacket.currentContext.includes('No current branch detected; repository may be in detached HEAD.'));
});

test('repository handoff rendering masks sensitive-looking issue titles', () => {
  const cwd = fixtureDir();
  const runner: ReadOnlyCommandRunner = (argv) => {
    const key = argv.join(' ');
    if (key === 'git rev-parse --show-toplevel') return ok(argv, `${cwd}\n`);
    if (key === 'git branch --show-current') return ok(argv, 'main\n');
    if (key === 'git status --short') return ok(argv, '');
    if (key === 'git remote -v') return ok(argv, 'origin\thttps://github.com/example/repo.git (fetch)\n');
    if (key === 'gh repo view --json nameWithOwner,isPrivate,defaultBranchRef,url') return ok(argv, '{"nameWithOwner":"example/repo","isPrivate":true,"defaultBranchRef":{"name":"main"}}\n');
    if (key === 'gh issue list --state open --limit 10 --json number,title,updatedAt') {
      const tokenLike = ['gh', 'p_', 'FAKEVALUEFAKEVALUEFAKEVALUE'].join('');
      return ok(argv, JSON.stringify([{ number: 9, title: `Synthetic ${tokenLike}`, updatedAt: '2026-07-02T00:00:00Z' }]));
    }
    if (key === 'gh pr list --state open --limit 10 --json number,title,isDraft,updatedAt') return ok(argv, '[]');
    return fail(argv, 'not found');
  };
  const markdown = renderRepositoryHandoffPacket({ cwd, generatedAt: '2026-07-02T00:00:00.000Z', runCommand: runner });

  assert.match(markdown, /Preflight: blocked/);
  assert.doesNotMatch(markdown, /FAKEVALUEFAKEVALUEFAKEVALUE/);
});

test('repository handoff preflight scans and redacts rendered remote names', () => {
  const cwd = fixtureDir();
  const tokenLike = ['gh', 'p_', 'FAKEVALUEFAKEVALUEFAKEVALUE'].join('');
  const options = { cwd, generatedAt: '2026-07-02T00:00:00.000Z', runCommand: fakeRunner(cwd, tokenLike) };
  const packet = buildRepositoryHandoffPacket(options);
  const markdown = renderRepositoryHandoffPacket(options);

  assert.equal(packet.preflight.status, 'blocked');
  assert.doesNotMatch(markdown, /FAKEVALUEFAKEVALUEFAKEVALUE/);
});
