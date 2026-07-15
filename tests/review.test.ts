import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPullRequestReviewPacket, buildSyntheticReviewPacket, renderPullRequestReviewPacket, renderSyntheticReviewPacket } from '../src/commands/review.ts';
import { MAX_PACKAGE_JSON_BYTES, UNCONFIRMED_REPOSITORY_VERIFICATION } from '../src/commands/repositoryVerificationPlan.ts';
import type { ReadOnlyCommandResult, ReadOnlyCommandRunner } from '../src/shell/runReadOnlyCommand.ts';

function ok(argv: readonly string[], stdout: string): ReadOnlyCommandResult {
  return { argv: [...argv], allowed: true, ok: true, exitCode: 0, stdout, stderr: '', truncated: false, durationMs: 1, reason: 'test command allowed' };
}
function fail(argv: readonly string[], stderr: string): ReadOnlyCommandResult {
  return { argv: [...argv], allowed: true, ok: false, exitCode: 1, stdout: '', stderr, truncated: false, durationMs: 1, reason: 'test command allowed' };
}
function fakePrViewRunner(body: string, headRefName = 'feature-demo', repositoryRoot = process.cwd()): ReadOnlyCommandRunner {
  return (argv) => {
    const key = argv.join(' ');
    if (key === 'gh pr view 7 --json number,title,state,author,isDraft,baseRefName,headRefName,mergeable,reviewDecision,additions,deletions,changedFiles,files,comments,reviews,statusCheckRollup,body,createdAt,updatedAt,url') {
      return ok(argv, JSON.stringify({
        number: 7,
        title: 'Synthetic PR adds read-only output',
        state: 'OPEN',
        author: { login: 'demo-user' },
        isDraft: false,
        baseRefName: 'main',
        headRefName,
        mergeable: 'MERGEABLE',
        reviewDecision: 'REVIEW_REQUIRED',
        additions: 42,
        deletions: 6,
        changedFiles: 2,
        files: [{ path: 'src/cli.ts', additions: 18, deletions: 2 }, { path: 'tests/cli.test.ts', additions: 24, deletions: 4 }],
        comments: [{ author: { login: 'maintainer-demo' }, body: 'Please confirm the smoke command remains read-only.', createdAt: '2026-07-02T00:00:00Z' }],
        reviews: [{ author: { login: 'reviewer-demo' }, state: 'COMMENTED', body: 'Looks small; verify docs match behavior.', submittedAt: '2026-07-02T00:00:00Z' }],
        statusCheckRollup: [{ name: 'sanity', conclusion: 'SUCCESS' }],
        body,
        url: 'https://github.com/example/repo/pull/7',
        createdAt: '2026-07-01T00:00:00Z',
        updatedAt: '2026-07-02T00:00:00Z',
      }));
    }
    if (key === 'git rev-parse --show-toplevel') return ok(argv, `${repositoryRoot}\n`);
    if (key === 'git remote -v') return ok(argv, 'origin\thttps://github.com/example/repo.git (fetch)\n');
    return fail(argv, 'not found');
  };
}

function repositoryFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'mck-review-repo-'));
  mkdirSync(join(root, '.git'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { lint: 'node lint.mjs', build: 'node build.mjs' } }), 'utf8');
  writeFileSync(join(root, 'package-lock.json'), '{}', 'utf8');
  return root;
}

test('synthetic review packet uses public-safe demo source', () => {
  const packet = buildSyntheticReviewPacket('2026-07-02T00:00:00.000Z');
  assert.equal(packet.kind, 'review');
  assert.equal(packet.source, 'synthetic/demo-repository#202');
  assert.equal(packet.preflight.status, 'pass');
});

test('synthetic review rendering includes review-specific sections', () => {
  const markdown = renderSyntheticReviewPacket('2026-07-02T00:00:00.000Z');
  assert.match(markdown, /# Maintainer Task Packet: review - synthetic\/demo-repository#202/);
  assert.match(markdown, /## 9\. Risk Checklist/);
  assert.match(markdown, /This preflight is best-effort/);
});

test('pull request review packet collects read-only PR details', () => {
  const body = 'This PR updates CLI routing. Verification: npm test passes. Risk: no write behavior.';
  const cwd = repositoryFixture();
  const packet = buildPullRequestReviewPacket('7', { cwd, generatedAt: '2026-07-02T00:00:00.000Z', runCommand: fakePrViewRunner(body, 'feature-demo', cwd) });
  assert.equal(packet.kind, 'review');
  assert.equal(packet.source, 'pr #7');
  assert.equal(packet.preflight.status, 'pass');
  assert.ok(packet.currentContext.some((item) => item.includes('Synthetic PR adds read-only output')));
  assert.ok(packet.technicalSurface.some((item) => item.includes('src/cli.ts')));
  assert.ok(packet.verificationPlan.includes('Repository metadata declares common npm verification scripts. Inspect package.json and repository documentation before deciding which commands to run.'));
  assert.equal(packet.verificationPlan.some((item) => item.startsWith('Run npm ')), false);
});

test('pull request review falls back for oversized package metadata', () => {
  const cwd = repositoryFixture();
  const oversizedManifest = `{"scripts":{"test":"node --test"},"padding":"${'x'.repeat(MAX_PACKAGE_JSON_BYTES)}"}`;
  writeFileSync(join(cwd, 'package.json'), oversizedManifest, 'utf8');

  const packet = buildPullRequestReviewPacket('7', { cwd, runCommand: fakePrViewRunner('Safe synthetic body.', 'feature-demo', cwd) });

  assert.ok(packet.verificationPlan.includes(UNCONFIRMED_REPOSITORY_VERIFICATION));
  assert.equal(packet.verificationPlan.some((item) => item.startsWith('Run npm ')), false);
});

test('pull request review does not reuse verification commands from a different local repository', () => {
  const cwd = repositoryFixture();
  const runner: ReadOnlyCommandRunner = (argv) => {
    const key = argv.join(' ');
    if (key === 'gh pr view https://github.com/example/other/pull/7 --json number,title,state,author,isDraft,baseRefName,headRefName,mergeable,reviewDecision,additions,deletions,changedFiles,files,comments,reviews,statusCheckRollup,body,createdAt,updatedAt,url') {
      return ok(argv, JSON.stringify({
        number: 7,
        title: 'Synthetic PR',
        state: 'OPEN',
        body: 'Safe synthetic body.',
        url: 'https://github.com/example/other/pull/7',
      }));
    }
    if (key === 'git rev-parse --show-toplevel') return ok(argv, `${cwd}\n`);
    if (key === 'git remote -v') return ok(argv, 'origin\thttps://github.com/example/repo.git (fetch)\n');
    return fail(argv, 'not found');
  };

  const packet = buildPullRequestReviewPacket('https://github.com/example/other/pull/7', { cwd, runCommand: runner });

  assert.ok(packet.verificationPlan.includes('Use the target repository\'s documented verification commands; no local command was assumed.'));
  assert.equal(packet.verificationPlan.some((item) => item.startsWith('Run npm ')), false);
});

test('pull request review rendering redacts sensitive-looking text', () => {
  const tokenLike = ['gh', 'p_', 'FAKEVALUEFAKEVALUEFAKEVALUE'].join('');
  const markdown = renderPullRequestReviewPacket('7', { generatedAt: '2026-07-02T00:00:00.000Z', runCommand: fakePrViewRunner(`Verification pasted ${tokenLike}`) });
  assert.match(markdown, /Preflight: blocked/);
  assert.doesNotMatch(markdown, /FAKEVALUEFAKEVALUEFAKEVALUE/);
});

test('pull request review preflight scans and redacts rendered branch names', () => {
  const tokenLike = ['gh', 'p_', 'FAKEVALUEFAKEVALUEFAKEVALUE'].join('');
  const options = { generatedAt: '2026-07-02T00:00:00.000Z', runCommand: fakePrViewRunner('Safe synthetic body.', tokenLike) };
  const packet = buildPullRequestReviewPacket('7', options);
  const markdown = renderPullRequestReviewPacket('7', options);

  assert.equal(packet.preflight.status, 'blocked');
  assert.doesNotMatch(markdown, /FAKEVALUEFAKEVALUEFAKEVALUE/);
});

test('pull request collection failure returns a packet instead of throwing', () => {
  const runner: ReadOnlyCommandRunner = (argv) => fail(argv, 'could not resolve pull request');
  const packet = buildPullRequestReviewPacket('404', { generatedAt: '2026-07-02T00:00:00.000Z', runCommand: runner });
  assert.equal(packet.kind, 'review');
  assert.match(packet.currentContext[0], /unavailable or failed/);
});
