import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { runReadOnlyCommand } from '../src/shell/runReadOnlyCommand.ts';

test('runReadOnlyCommand blocks disallowed command before execution', () => {
  const result = runReadOnlyCommand(['gh', 'issue', 'create', '--title', 'x']);

  assert.equal(result.allowed, false);
  assert.equal(result.ok, false);
  assert.match(result.reason, /not read-only/);
  assert.equal(result.exitCode, null);
});

test('runReadOnlyCommand blocks write-capable gh api shapes before execution', () => {
  const commands = [
    ['gh', 'api', '/repos/owner/repo/issues', '-f', 'title=synthetic'],
    ['gh', 'api', '/repos/owner/repo/issues', '--input', 'synthetic.json'],
    ['gh', 'api', 'graphql', '-f', 'query=mutation { synthetic }'],
    ['gh', 'api', '/graphql'],
    ['gh', 'api', '--verbose', '/repos/owner/repo'],
    ['gh', 'api', '-H', 'X-Synthetic: value', '/repos/owner/repo'],
    ['gh', 'api', '--unknown-flag', '/repos/owner/repo'],
    ['gh', 'api'],
  ];

  for (const argv of commands) {
    const result = runReadOnlyCommand(argv);

    assert.equal(result.allowed, false, argv.join(' '));
    assert.equal(result.ok, false, argv.join(' '));
    assert.equal(result.exitCode, null, argv.join(' '));
    assert.equal(result.stdout, '', argv.join(' '));
    assert.equal(result.stderr, '', argv.join(' '));
    assert.match(result.reason, /read-only policy/, argv.join(' '));
  }
});

test('runReadOnlyCommand executes allowed Node command safely', () => {
  const result = runReadOnlyCommand(['git', 'version']);

  assert.equal(result.allowed, true);
  assert.equal(typeof result.ok, 'boolean');
  assert.equal(result.argv.join(' '), 'git version');
});

test('runReadOnlyCommand forces Git optional locks off', () => {
  const binDir = mkdtempSync(join(tmpdir(), 'mck-git-env-'));
  const gitPath = join(binDir, 'git');
  writeFileSync(gitPath, '#!/bin/sh\nprintf "%s\\n" "$GIT_OPTIONAL_LOCKS"\n');
  chmodSync(gitPath, 0o755);

  const result = runReadOnlyCommand(['git', 'version'], {
    env: {
      PATH: `${binDir}${delimiter}${process.env.PATH ?? ''}`,
      GIT_OPTIONAL_LOCKS: '1',
    },
  });

  assert.equal(result.allowed, true);
  assert.equal(result.ok, true);
  assert.equal(result.stdout.trim(), '0');
});
