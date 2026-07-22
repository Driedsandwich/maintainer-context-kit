import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveGitHubSourceProvenance, sourceLabel, validateExplicitSourceTarget } from '../src/commands/sourceProvenance.ts';

test('resolves canonical issue provenance without local repository inference', () => {
  const result = resolveGitHubSourceProvenance('issue', 'https://github.com/Example/Repo/issues/123', 123);

  assert.deepEqual(result, {
    ok: true,
    value: {
      sourceType: 'issue',
      repository: 'Example/Repo',
      number: 123,
      canonicalUrl: 'https://github.com/Example/Repo/issues/123',
    },
  });
  if (result.ok) assert.equal(sourceLabel(result.value), 'Example/Repo issue #123');
});

test('resolves canonical pull request provenance', () => {
  const result = resolveGitHubSourceProvenance('pull_request', 'https://github.com/example/other/pull/7/', 7);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.repository, 'example/other');
    assert.equal(result.value.canonicalUrl, 'https://github.com/example/other/pull/7');
    assert.equal(sourceLabel(result.value), 'example/other pull request #7');
  }
});

test('rejects missing, malformed, and non-canonical source URLs', () => {
  for (const sourceUrl of [
    undefined,
    'not-a-url',
    'http://github.com/example/repo/issues/123',
    'https://example.test/example/repo/issues/123',
    'https://github.com/example/repo/issues/123?view=1',
  ]) {
    assert.equal(resolveGitHubSourceProvenance('issue', sourceUrl, 123).ok, false);
  }
});

test('rejects missing or inconsistent source numbers and item types', () => {
  assert.equal(resolveGitHubSourceProvenance('issue', 'https://github.com/example/repo/issues/123', undefined).ok, false);
  assert.equal(resolveGitHubSourceProvenance('issue', 'https://github.com/example/repo/issues/123', 124).ok, false);
  assert.equal(resolveGitHubSourceProvenance('issue', 'https://github.com/example/repo/pull/123', 123).ok, false);
  assert.equal(resolveGitHubSourceProvenance('pull_request', 'https://github.com/example/repo/issues/123', 123).ok, false);
});

test('explicit URL targets must match returned provenance while number targets need no repository inference', () => {
  const resolved = resolveGitHubSourceProvenance('issue', 'https://github.com/example/repo/issues/123', 123);
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;

  assert.deepEqual(validateExplicitSourceTarget('123', resolved.value), { ok: true });
  assert.deepEqual(validateExplicitSourceTarget('https://github.com/example/repo/issues/123/', resolved.value), { ok: true });
  assert.equal(validateExplicitSourceTarget('https://github.com/example/other/issues/123', resolved.value).ok, false);
  assert.equal(validateExplicitSourceTarget('https://github.com/example/repo/issues/123?view=1', resolved.value).ok, false);
});
