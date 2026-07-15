import test from 'node:test';
import assert from 'node:assert/strict';
import { maskSensitiveValue, PREFLIGHT_LIMITATION, redactSensitiveText, runPreflight } from '../src/packet/preflight.ts';

test('preflight passes clean synthetic text', () => {
  const result = runPreflight('Synthetic public-safe issue summary names the github_pat_ prefix but contains no credential.', '2026-07-02T00:00:00.000Z');

  assert.equal(result.status, 'pass');
  assert.equal(result.findings.length, 0);
  assert.equal(result.limitation, PREFLIGHT_LIMITATION);
});

test('preflight warns on email and local path patterns', () => {
  const result = runPreflight('Contact demo.user@example.test from /Users/demo/project before sharing.', '2026-07-02T00:00:00.000Z');

  assert.equal(result.status, 'warning');
  assert.ok(result.findings.some((finding) => finding.id === 'email-like'));
  assert.ok(result.findings.some((finding) => finding.id === 'private-path-like'));
});

test('preflight fully redacts bounded synthetic private local paths', () => {
  const fixtures = [
    {
      path: ['', ['Us', 'ers'].join(''), 'synthetic-user-macos', 'synthetic-client-macos', 'private-notes-macos.md'].join('/'),
      components: ['synthetic-user-macos', 'synthetic-client-macos', 'private-notes-macos.md'],
    },
    {
      path: ['', ['ho', 'me'].join(''), 'synthetic-user-linux', 'synthetic-project-linux', 'private-notes-linux.md'].join('/'),
      components: ['synthetic-user-linux', 'synthetic-project-linux', 'private-notes-linux.md'],
    },
    {
      path: [['C', ':'].join(''), ['Us', 'ers'].join(''), 'synthetic-user-windows', 'synthetic-case-windows', 'private-notes-windows.md'].join('\\'),
      components: ['synthetic-user-windows', 'synthetic-case-windows', 'private-notes-windows.md'],
    },
  ];

  for (const fixture of fixtures) {
    const source = `Before ${fixture.path}, keep this sentence and https://example.test/Users/public/docs.`;
    const result = runPreflight(source, '2026-07-16T00:00:00.000Z');
    const redacted = redactSensitiveText(source);

    assert.equal(result.status, 'warning');
    assert.ok(result.findings.some((finding) => finding.id === 'private-path-like'));
    assert.equal(result.findings.find((finding) => finding.id === 'private-path-like')?.excerpt, '[private-path]');
    assert.equal(JSON.stringify(result).includes(fixture.path), false);
    assert.equal(redacted.includes(fixture.path), false);
    for (const component of fixture.components) {
      assert.equal(JSON.stringify(result).includes(component), false);
      assert.equal(redacted.includes(component), false);
    }
    assert.match(redacted, /^Before \[private-path\], keep this sentence and https:\/\/example\.test\/Users\/public\/docs\.$/);
    assert.equal(redactSensitiveText(`Review \`${fixture.path}\` now.`), 'Review `[private-path]` now.');
    assert.equal(redactSensitiveText(`Review (${fixture.path}) now.`), 'Review ([private-path]) now.');
  }
});

test('preflight blocks synthetic GitHub-token-like values without exposing them', () => {
  const fakeToken = ['gh', 'p_', 'FAKEVALUEFAKEVALUEFAKEVALUE'].join('');
  const result = runPreflight(`token = ${fakeToken}`, '2026-07-02T00:00:00.000Z');

  assert.equal(result.status, 'blocked');
  assert.ok(result.findings.some((finding) => finding.id === 'github-token-like'));
  assert.ok(result.findings.some((finding) => finding.label === 'GitHub token-like value'));
  assert.equal(result.findings.some((finding) => finding.excerpt.includes(fakeToken)), false);
});

test('preflight blocks and redacts synthetic fine-grained GitHub-token-like values', () => {
  const fakeToken = ['github', '_pat_', 'invalid_synthetic_', 'A'.repeat(24)].join('');
  const result = runPreflight(`token = ${fakeToken}`, '2026-07-15T00:00:00.000Z');
  const redacted = redactSensitiveText(`token = ${fakeToken}`);

  assert.equal(result.status, 'blocked');
  assert.ok(result.findings.some((finding) => finding.id === 'github-fine-grained-token-like'));
  assert.ok(result.findings.some((finding) => finding.label === 'GitHub fine-grained token-like value'));
  assert.equal(JSON.stringify(result).includes(fakeToken), false);
  assert.equal(redacted.includes(fakeToken), false);
});

test('preflight warns and redacts separator-bearing synthetic credential assignments', () => {
  for (const separator of ['/', '+', '=', ':']) {
    const syntheticValue = ['invalid', separator, 'synthetic', '_value_', 'A'.repeat(12)].join('');
    const source = `api_key = "${syntheticValue}"; keep this sentence.`;
    const result = runPreflight(source, '2026-07-16T00:00:00.000Z');
    const redacted = redactSensitiveText(source);

    assert.equal(result.status, 'warning');
    assert.ok(result.findings.some((finding) => finding.id === 'credential-assignment-like'));
    assert.equal(JSON.stringify(result).includes(syntheticValue), false);
    assert.equal(redacted.includes(syntheticValue), false);
    assert.notEqual(redacted, source);
    assert.match(redacted, /; keep this sentence\.$/);
  }

  const separatorFreeValue = ['invalid', 'synthetic', 'value', 'A'.repeat(12)].join('');
  const separatorFreeSource = `token: ${separatorFreeValue}`;
  const separatorFreeResult = runPreflight(separatorFreeSource, '2026-07-16T00:00:00.000Z');

  assert.equal(separatorFreeResult.status, 'warning');
  assert.equal(redactSensitiveText(separatorFreeSource).includes(separatorFreeValue), false);
  assert.equal(runPreflight('token = use/the documented placeholder').status, 'pass');
});

test('preflight blocks synthetic private-key-like blocks without exposing them', () => {
  const fakeBlock = [
    '-----BEGIN ',
    'PRIVATE KEY-----',
    'NOT_REAL_SYNTHETIC_TEST_VALUE',
    '-----END ',
    'PRIVATE KEY-----',
  ].join('');
  const result = runPreflight(fakeBlock, '2026-07-02T00:00:00.000Z');

  assert.equal(result.status, 'blocked');
  assert.ok(result.findings.some((finding) => finding.id === 'private-key-block'));
  assert.equal(result.findings.some((finding) => finding.excerpt.includes('NOT_REAL_SYNTHETIC_TEST_VALUE')), false);
});

test('maskSensitiveValue preserves only short edges', () => {
  assert.equal(maskSensitiveValue('abcdefghijklmnop'), 'abcd…mnop');
});
