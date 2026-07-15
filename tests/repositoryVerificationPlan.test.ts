import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRepositoryVerificationSteps,
  MAX_PACKAGE_JSON_BYTES,
  REPOSITORY_NPM_VERIFICATION_REQUIRES_REVIEW,
  repositoryNameMatchesLocalGitHubRepository,
  targetMatchesLocalGitHubRepository,
  UNCONFIRMED_REPOSITORY_VERIFICATION,
} from '../src/commands/repositoryVerificationPlan.ts';

function manifestWithByteLength(byteLength: number): string {
  const prefix = '{"packageManager":"npm@10","scripts":{"test":"node --test"},"padding":"';
  const suffix = '"}';
  const paddingLength = byteLength - Buffer.byteLength(prefix) - Buffer.byteLength(suffix);
  assert.ok(paddingLength >= 0);
  return `${prefix}${'x'.repeat(paddingLength)}${suffix}`;
}

function repositoryFixture(packageJson?: string, packageManager: 'npm' | 'pnpm' | 'none' = 'npm'): string {
  const root = mkdtempSync(join(tmpdir(), 'mck-verification-repo-'));
  mkdirSync(join(root, '.git'));
  if (packageJson !== undefined) {
    writeFileSync(join(root, 'package.json'), packageJson, 'utf8');
  }
  if (packageManager === 'npm') {
    writeFileSync(join(root, 'package-lock.json'), '{}', 'utf8');
  } else if (packageManager === 'pnpm') {
    writeFileSync(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n', 'utf8');
  }
  return root;
}

test('repository verification keeps repository-controlled npm scripts behind human review', () => {
  const syntheticMarker = ['UNTRUSTED', '_SCRIPT', '_BODY'].join('');
  const root = repositoryFixture(JSON.stringify({
    scripts: {
      check: `node scripts/check.mjs --marker=${syntheticMarker}`,
      'test:e2e': 'node scripts/e2e.mjs',
      build: 'node scripts/build.mjs',
      deploy: 'node scripts/deploy.mjs',
      'test:customer-secret': 'node scripts/private.mjs',
    },
  }));

  const steps = buildRepositoryVerificationSteps(root, true);

  assert.deepEqual(steps, [REPOSITORY_NPM_VERIFICATION_REQUIRES_REVIEW]);
  assert.equal(steps.some((step) => step.startsWith('Run npm ')), false);
  assert.equal(steps.some((step) => step.includes(syntheticMarker)), false);
});

test('repository verification does not turn a test script into trusted execution guidance', () => {
  const root = repositoryFixture(JSON.stringify({ scripts: { test: 'node --test' } }));

  assert.deepEqual(buildRepositoryVerificationSteps(root, true), [REPOSITORY_NPM_VERIFICATION_REQUIRES_REVIEW]);
});

test('repository verification accepts a valid manifest exactly at the byte limit', () => {
  const root = repositoryFixture(manifestWithByteLength(MAX_PACKAGE_JSON_BYTES));

  assert.deepEqual(buildRepositoryVerificationSteps(root, true), [REPOSITORY_NPM_VERIFICATION_REQUIRES_REVIEW]);
});

test('repository verification rejects valid and malformed manifests over the byte limit', () => {
  const valid = repositoryFixture(manifestWithByteLength(MAX_PACKAGE_JSON_BYTES + 1));
  const malformed = repositoryFixture(`{"padding":"${'x'.repeat(MAX_PACKAGE_JSON_BYTES)}`);

  assert.deepEqual(buildRepositoryVerificationSteps(valid, true), [UNCONFIRMED_REPOSITORY_VERIFICATION]);
  assert.deepEqual(buildRepositoryVerificationSteps(malformed, true), [UNCONFIRMED_REPOSITORY_VERIFICATION]);
});

test('repository verification rejects symlinked and non-regular package metadata', (t) => {
  const workspace = mkdtempSync(join(tmpdir(), 'mck-package-metadata-boundary-'));
  const symlinkRepository = join(workspace, 'symlink-repository');
  const directoryRepository = join(workspace, 'directory-repository');
  const outsideManifest = join(workspace, 'outside-package.json');
  mkdirSync(symlinkRepository);
  mkdirSync(directoryRepository);
  writeFileSync(outsideManifest, JSON.stringify({ packageManager: 'npm@10', scripts: { test: 'node --test' } }), 'utf8');
  symlinkSync(outsideManifest, join(symlinkRepository, 'package.json'));
  mkdirSync(join(directoryRepository, 'package.json'));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));

  assert.deepEqual(buildRepositoryVerificationSteps(symlinkRepository, true), [UNCONFIRMED_REPOSITORY_VERIFICATION]);
  assert.deepEqual(buildRepositoryVerificationSteps(directoryRepository, true), [UNCONFIRMED_REPOSITORY_VERIFICATION]);
});

test('every recognized npm verification script name stays non-executable guidance', () => {
  const scriptNames = ['test', 'check', 'lint', 'typecheck', 'test:unit', 'test:integration', 'test:e2e', 'test:sidepanel', 'build'];

  for (const scriptName of scriptNames) {
    const root = repositoryFixture(JSON.stringify({ scripts: { [scriptName]: 'node synthetic-script.mjs' } }));
    const steps = buildRepositoryVerificationSteps(root, true);

    assert.deepEqual(steps, [REPOSITORY_NPM_VERIFICATION_REQUIRES_REVIEW]);
    assert.equal(steps.some((step) => step.startsWith('Run npm ')), false);
  }
});

test('repository verification falls back without package metadata or supported scripts', () => {
  const noPackage = repositoryFixture();
  const unsupported = repositoryFixture(JSON.stringify({ scripts: { start: 'node app.js' } }));
  const invalid = repositoryFixture('{ invalid json');

  assert.deepEqual(buildRepositoryVerificationSteps(noPackage, true), [UNCONFIRMED_REPOSITORY_VERIFICATION]);
  assert.deepEqual(buildRepositoryVerificationSteps(unsupported, true), [UNCONFIRMED_REPOSITORY_VERIFICATION]);
  assert.deepEqual(buildRepositoryVerificationSteps(invalid, true), [UNCONFIRMED_REPOSITORY_VERIFICATION]);
});

test('repository verification does not assume npm without npm package-manager evidence', () => {
  const noManager = repositoryFixture(JSON.stringify({ scripts: { test: 'node --test' } }), 'none');
  const pnpm = repositoryFixture(JSON.stringify({ packageManager: 'pnpm@10.0.0', scripts: { test: 'node --test' } }), 'pnpm');

  assert.deepEqual(buildRepositoryVerificationSteps(noManager, true), [UNCONFIRMED_REPOSITORY_VERIFICATION]);
  assert.deepEqual(buildRepositoryVerificationSteps(pnpm, true), [UNCONFIRMED_REPOSITORY_VERIFICATION]);
});

test('repository verification does not reuse local commands for an unconfirmed target repository', () => {
  const root = repositoryFixture(JSON.stringify({ scripts: { test: 'node --test' } }));

  assert.deepEqual(buildRepositoryVerificationSteps(root, false), [UNCONFIRMED_REPOSITORY_VERIFICATION]);
  assert.equal(targetMatchesLocalGitHubRepository(
    'https://github.com/example/repo/issues/123',
    'origin\tgit@github.com:example/repo.git (fetch)\n',
  ), true);
  assert.equal(targetMatchesLocalGitHubRepository(
    'https://github.com/example/other/issues/123',
    'origin\thttps://github.com/example/repo.git (fetch)\n',
  ), false);
  assert.equal(targetMatchesLocalGitHubRepository(undefined, 'origin\thttps://github.com/example/repo.git (fetch)\n'), false);
  assert.equal(repositoryNameMatchesLocalGitHubRepository('example/repo', 'origin\thttps://github.com/example/repo.git (fetch)\n'), true);
  assert.equal(repositoryNameMatchesLocalGitHubRepository('example/other', 'origin\thttps://github.com/example/repo.git (fetch)\n'), false);
});
